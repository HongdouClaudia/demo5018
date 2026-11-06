#!/usr/bin/env ruby
# frozen_string_literal: true

require 'webrick'
require 'json'
require 'net/http'
require 'uri'
require 'openssl'
require 'fileutils'

ROOT = File.expand_path(__dir__)
DATA_PATH = File.join(ROOT, 'data.json')
SEED_PATH = File.join(ROOT, 'seed.json')

def load_env_file
  env_path = File.join(ROOT, '.env')
  return unless File.exist?(env_path)

  File.readlines(env_path, chomp: true).each do |line|
    next if line.strip.empty? || line.start_with?('#') || !line.include?('=')
    key, value = line.split('=', 2)
    ENV[key.strip] ||= value.strip.sub(/\A["']|["']\z/, '')
  end
end

load_env_file

def read_state
  FileUtils.cp(SEED_PATH, DATA_PATH) unless File.exist?(DATA_PATH)
  JSON.parse(File.read(DATA_PATH))
end

def write_state(state)
  File.write(DATA_PATH, JSON.pretty_generate(state))
end

def json_response(res, status, body)
  res.status = status
  res['Content-Type'] = 'application/json; charset=utf-8'
  res['Cache-Control'] = 'no-store'
  res.body = JSON.generate(body)
end

def request_json(req)
  JSON.parse(req.body.to_s)
rescue JSON::ParserError
  nil
end

def normalize_agent_result(content)
  result = JSON.parse(content)
  raise '缺少菜谱结果' unless result.is_a?(Hash)
  result['recipes'] = [] unless result['recipes'].is_a?(Array)
  result['alerts'] = [] unless result['alerts'].is_a?(Array)
  result['shopping'] = [] unless result['shopping'].is_a?(Array)
  result
rescue JSON::ParserError
  raise '模型没有返回可读取的 JSON 内容，请重试。'
end

def restricted_foods(preferences)
  (Array(preferences['allergies']) + Array(preferences['avoid'])).map { |item| item.to_s.strip.downcase }.reject(&:empty?).uniq
end

def mentions_restricted_food?(value, restricted)
  text = value.to_s.downcase
  restricted.any? { |food| text.include?(food) }
end

def recipe_mentions_restricted_food?(recipe, restricted)
  text_parts = [recipe['title'], recipe['subtitle'], recipe['reason']] + Array(recipe['steps'])
  Array(recipe['ingredients']).each do |ingredient|
    text_parts << ingredient['name']
    text_parts.concat(Array(ingredient['substitutes']))
  end
  text_parts.any? { |part| mentions_restricted_food?(part, restricted) }
end

def enforce_food_restrictions(result, preferences)
  restricted = restricted_foods(preferences)
  return result if restricted.empty?

  original_recipes = Array(result['recipes'])
  result['recipes'] = original_recipes.reject { |recipe| recipe_mentions_restricted_food?(recipe, restricted) }
  result['shopping'] = Array(result['shopping']).reject { |item| mentions_restricted_food?(item['name'], restricted) }
  if result['recipes'].length < original_recipes.length
    result['summary'] = "#{result['summary']} 已按过敏提示和忌口排除不适合的食材。".strip
  end
  result
end

def ask_deepseek(question, state)
  api_key = ENV['DEEPSEEK_API_KEY']
  raise '未找到 DEEPSEEK_API_KEY，请先在 .env 中配置有效密钥。' if api_key.to_s.empty?

  inventory_context = state.fetch('inventory', []).map do |item|
    {
      id: item['id'], name: item['name'], quantity: item['quantity'], unit: item['unit'], location: item['location'],
      freshness: item['freshness'], expiryDate: item['expiryDate']
    }
  end
  context = {
    user_question: question,
    preferences: state.fetch('preferences', {}),
    hard_constraints: { priority: '过敏提示和忌口 > 临期食材 > 现有库存 > 口味偏好', excluded_foods: restricted_foods(state.fetch('preferences', {})) },
    inventory: inventory_context,
    shopping: state.fetch('shopping', []).select { |item| item['status'] == 'pending' }
  }
  system_prompt = <<~PROMPT
    你是“智能厨房管家”，服务目标是减少食物浪费、提升家庭做饭效率。
    根据用户问题、家庭库存和偏好，给出可执行建议。
    【最高优先级安全规则】用户的“过敏提示”和“忌口”是硬性排除条件，优先级高于临期食材、库存利用和口味偏好。不得在菜名、食材、替代方案、步骤或补购清单中出现这些食材；无法满足时宁可不推荐菜谱并说明原因。只有通过该筛选后，才优先使用临期食材和现有库存。
    只返回 JSON，不能输出 Markdown。必须遵守以下结构：
    {
      "summary":"一句话建议",
      "insight":"简短库存或饮食总结",
      "health_note":"大致热量或蛋白质等估算提示，必须包含‘仅供参考’",
      "alerts":[{"name":"食材名","message":"预警说明","urgency":"high|medium"}],
      "recipes":[{
        "id":"唯一英文或数字 id",
        "title":"菜名",
        "subtitle":"简短描述",
        "duration":20,
        "difficulty":"简单|中等|挑战",
        "servings":2,
        "imageEmoji":"一个合适的食物 emoji",
        "imageKey":"从 tomato-chicken-broccoli、tomato-egg、tomato-egg-broccoli-soup、garlic-broccoli、tomato-egg-rice、chicken-broccoli-rice、chicken-broccoli、tomato-chicken-broccoli-soup 中选择最匹配的一项；无法匹配时留空",
        "tags":["临期优先|库存充足|需要补购|口味匹配"],
        "reason":"推荐原因",
        "appliances":["厨具"],
        "ingredients":[{"name":"食材名","quantity":200,"unit":"g|个|勺|ml","available":true,"inventoryId":"库存id或空字符串","substitutes":["替代品"]}],
        "steps":["步骤一","步骤二","步骤三"]
      }],
      "shopping":[{"name":"缺少食材","quantity":1,"unit":"个|g|盒","category":"蔬果|肉禽|水产|调味品|其他","source":"菜名"}]
    }
    recipes 最多返回 3 条。只有库存不足时才在 shopping 中列出缺料。若没有适合菜谱，recipes 可以为空，但仍要给出可执行建议。
    imageKey 只选择与菜名和主要食材都相符的图片；不能为了匹配图片而改变菜谱食材，不匹配时留空。
  PROMPT

  uri = URI('https://api.deepseek.com/chat/completions')
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.verify_mode = OpenSSL::SSL::VERIFY_PEER
  http.open_timeout = 15
  http.read_timeout = 60
  request = Net::HTTP::Post.new(uri)
  request['Content-Type'] = 'application/json'
  request['Authorization'] = "Bearer #{api_key}"
  request.body = JSON.generate(
    model: ENV.fetch('DEEPSEEK_MODEL', 'deepseek-chat'),
    temperature: 0.4,
    max_tokens: 2200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system_prompt },
      { role: 'user', content: JSON.generate(context) }
    ]
  )
  response = http.request(request)
  payload = JSON.parse(response.body)
  unless response.is_a?(Net::HTTPSuccess)
    message = payload.dig('error', 'message') || "DeepSeek 请求失败（#{response.code}）"
    raise message
  end
  content = payload.dig('choices', 0, 'message', 'content')
  raise 'DeepSeek 未返回内容，请重试。' if content.to_s.strip.empty?
  enforce_food_restrictions(normalize_agent_result(content), state.fetch('preferences', {}))
rescue Net::OpenTimeout, Net::ReadTimeout
  raise 'DeepSeek 请求超时，请稍后重试。'
rescue SocketError
  raise '无法连接 DeepSeek 服务，请检查网络。'
end

def new_id(prefix)
  "#{prefix}-#{Time.now.to_i}-#{rand(1000..9999)}"
end

def search_recipe_image(recipe)
  api_key = ENV['SERPAPI_API_KEY']
  raise '未找到 SERPAPI_API_KEY，请在本地 .env 配置 SerpApi 密钥。' if api_key.to_s.empty?
  title = recipe['title'].to_s.strip
  raise '菜谱名称为空，无法搜索图片。' if title.empty?
  ingredients = Array(recipe['ingredients']).map { |item| item.is_a?(Hash) ? item['name'].to_s : item.to_s }.reject(&:empty?)
  query = [title, ingredients.join(' '), '菜品实拍'].reject(&:empty?).join(' ')
  params = URI.encode_www_form(engine: 'google_images', q: query, api_key: api_key, hl: 'zh-cn', gl: 'cn')
  uri = URI("https://serpapi.com/search.json?#{params}")
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.verify_mode = OpenSSL::SSL::VERIFY_PEER
  http.open_timeout = 10
  http.read_timeout = 30
  response = http.get(uri.request_uri)
  payload = JSON.parse(response.body)
  unless response.is_a?(Net::HTTPSuccess)
    raise(payload['error'] || "SerpApi 图片搜索失败（HTTP #{response.code}）。")
  end
  if payload['error']
    raise payload['error'].to_s
  end
  result = Array(payload['images_results']).find do |image|
    next false if image['unsafe'] == true
    begin
      image_uri = URI(image['thumbnail'].to_s)
      image_uri.is_a?(URI::HTTPS) && image_uri.host
    rescue URI::InvalidURIError
      false
    end
  end
  raise 'SerpApi 没有找到可用图片。' unless result
  source_uri = URI(result['link'].to_s) rescue nil
  source_url = source_uri&.is_a?(URI::HTTPS) ? source_uri.to_s : nil
  {
    image: result['thumbnail'],
    source: source_url,
    source_name: result['source'].to_s
  }
rescue JSON::ParserError
  raise '无法读取 SerpApi 的返回内容，请稍后重试。'
rescue Net::OpenTimeout, Net::ReadTimeout
  raise 'SerpApi 图片搜索超时，请稍后重试。'
rescue SocketError
  raise '无法连接 SerpApi，请检查网络。'
end

server = WEBrick::HTTPServer.new(
  Port: (ENV['PORT'] || 4567).to_i,
  BindAddress: '127.0.0.1',
  AccessLog: [],
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::WARN)
)

trap('INT') { server.shutdown }

server.mount_proc '/' do |req, res|
  begin
    if req.path == '/api/state' && req.request_method == 'GET'
      json_response(res, 200, read_state)
      next
    end

    if req.path == '/api/state' && req.request_method == 'PUT'
      body = request_json(req)
      raise '数据格式错误。' unless body.is_a?(Hash) && body['state'].is_a?(Hash)
      write_state(body['state'])
      json_response(res, 200, body['state'])
      next
    end

    if req.path == '/api/agent' && req.request_method == 'POST'
      body = request_json(req)
      question = body && body['question'].to_s.strip
      raise '请输入想让厨房管家处理的任务。' if question.empty?
      json_response(res, 200, ask_deepseek(question, read_state))
      next
    end

    if req.path == '/api/recipe-image' && req.request_method == 'POST'
      body = request_json(req) || {}
      image = search_recipe_image(body['recipe'].is_a?(Hash) ? body['recipe'] : {})
      json_response(res, 200, image)
      next
    end

    if req.path == '/api/sync-shopping' && req.request_method == 'POST'
      body = request_json(req) || {}
      ids = Array(body['ids'])
      state = read_state
      synced = []
      state['shopping'].each do |item|
        next unless ids.include?(item['id']) && item['status'] == 'bought'
        state['inventory'] << {
          'id' => new_id('inv'), 'name' => item['name'], 'quantity' => item['quantity'], 'unit' => item['unit'],
          'location' => item['location'] || '冷藏', 'freshness' => '新鲜', 'expiryDate' => item['expiryDate'] || '',
          'createdAt' => Time.now.strftime('%Y-%m-%d')
        }
        item['status'] = 'archived'
        item['syncedAt'] = Time.now.strftime('%Y-%m-%d %H:%M')
        synced << item['name']
      end
      state['history'] << { 'id' => new_id('history'), 'type' => 'purchase', 'title' => "采购入库：#{synced.join('、')}", 'date' => Time.now.strftime('%Y-%m-%d') } unless synced.empty?
      write_state(state)
      json_response(res, 200, state)
      next
    end

    if req.path == '/api/cook' && req.request_method == 'POST'
      body = request_json(req) || {}
      recipe = body['recipe'] || {}
      consumption = Array(body['consumption'])
      raise '没有可确认的烹饪食材。' if consumption.empty?
      state = read_state
      consumption.each do |line|
        item = state['inventory'].find { |entry| entry['id'] == line['inventoryId'] }
        next unless item
        used = line['quantity'].to_f
        item['quantity'] = [item['quantity'].to_f - used, 0].max
      end
      state['inventory'].reject! { |item| item['quantity'].to_f <= 0 }
      state['history'] << {
        'id' => new_id('cook'), 'type' => 'cook', 'title' => recipe['title'] || '完成烹饪',
        'recipeId' => recipe['id'], 'recipeTitle' => recipe['title'] || '完成烹饪',
        'imageEmoji' => recipe['imageEmoji'], 'date' => Time.now.strftime('%Y-%m-%d'),
        'detail' => "#{recipe['servings'] || 1} 人份", 'consumption' => consumption
      }
      write_state(state)
      json_response(res, 200, state)
      next
    end

    if req.path == '/' || req.path == '/index.html'
      file_path = File.join(ROOT, 'index.html')
    elsif req.path.match?(%r{\A/(app\.js|styles\.css)\z})
      file_path = File.join(ROOT, req.path.sub(%r{\A/}, ''))
    elsif req.path.match?(%r{\A/assets/recipes/[a-z0-9-]+\.jpg\z})
      file_path = File.join(ROOT, req.path.sub(%r{\A/}, ''))
    elsif req.path.match?(%r{\A/assets/generated/[a-f0-9]{64}\.jpg\z})
      file_path = File.join(ROOT, req.path.sub(%r{\A/}, ''))
    else
      json_response(res, 404, { error: '未找到接口或页面。' })
      next
    end

    unless File.exist?(file_path)
      json_response(res, 404, { error: '页面文件不存在。' })
      next
    end
    res.status = 200
    res['Content-Type'] = if file_path.end_with?('.css')
      'text/css; charset=utf-8'
    elsif file_path.end_with?('.js')
      'application/javascript; charset=utf-8'
    elsif file_path.end_with?('.jpg')
      'image/jpeg'
    else
      'text/html; charset=utf-8'
    end
    res.body = File.read(file_path)
  rescue StandardError => e
    json_response(res, 422, { error: e.message })
  end
end

puts "智能厨房管家已启动：http://127.0.0.1:#{server.config[:Port]}"
server.start
