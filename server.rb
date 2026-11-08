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
        "tags":["临期优先|库存充足|需要补购|口味匹配"],
        "reason":"推荐原因",
        "appliances":["厨具"],
        "ingredients":[{"name":"食材名","quantity":200,"unit":"g|个|勺|ml","available":true,"inventoryId":"库存id或空字符串","substitutes":["替代品"]}],
        "steps":["步骤一","步骤二","步骤三"]
      }],
      "shopping":[{"name":"缺少食材","quantity":1,"unit":"个|g|盒","category":"蔬果|肉禽|水产|调味品|其他","source":"菜名"}]
    }
    recipes 最多返回 3 条。只有库存不足时才在 shopping 中列出缺料。若没有适合菜谱，recipes 可以为空，但仍要给出可执行建议。
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

def parse_inventory_with_deepseek(text)
  api_key = ENV['DEEPSEEK_API_KEY']
  raise '未找到 DEEPSEEK_API_KEY，请先配置。' if api_key.to_s.empty?
  today = Time.now.strftime('%Y-%m-%d')
  prompt = "你处理的是家庭冰箱场景：食材通常已经历采摘或生产、运输、仓储和零售，新鲜度不能按果园刚采摘或刚生产计算。把用户文字拆成清单，只返回JSON：{\"items\":[{\"name\":\"食材名\",\"quantity\":1,\"unit\":\"个\",\"estimatedGrams\":150,\"location\":\"冷藏\",\"purchaseDate\":\"#{today}\",\"freshness\":\"新鲜\"}]}。结合食材性质、冷藏或冷冻、存入日期与今天#{today}判断freshness，只能是新鲜、尽快食用、不宜食用；要按家庭冰箱剩余可食用期保守判断。estimatedGrams为总重量估计。缺少数量默认1，缺少单位用常用家庭单位，缺少位置默认冷藏，缺少日期默认#{today}。最多20条，不输出解释或Markdown。"
  uri = URI('https://api.deepseek.com/chat/completions')
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.verify_mode = OpenSSL::SSL::VERIFY_PEER
  http.open_timeout = 15
  http.read_timeout = 60
  request = Net::HTTP::Post.new(uri)
  request['Content-Type'] = 'application/json'
  request['Authorization'] = "Bearer #{api_key}"
  request.body = JSON.generate(model: ENV.fetch('DEEPSEEK_MODEL', 'deepseek-chat'), temperature: 0.1, max_tokens: 1400, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }])
  response = http.request(request)
  payload = JSON.parse(response.body)
  raise(payload.dig('error', 'message') || "DeepSeek 请求失败（#{response.code}）") unless response.is_a?(Net::HTTPSuccess)
  result = JSON.parse(payload.dig('choices', 0, 'message', 'content').to_s)
  items = Array(result['items']).first(20).map do |item|
    name = item['name'].to_s.strip
    next if name.empty?
    freshness = %w[新鲜 尽快食用 不宜食用].include?(item['freshness']) ? item['freshness'] : '新鲜'
    { 'name' => name, 'quantity' => [item['quantity'].to_f, 0.1].max, 'unit' => item['unit'].to_s.strip.empty? ? '个' : item['unit'].to_s.strip, 'estimatedGrams' => [item['estimatedGrams'].to_f, 0].max.round, 'location' => item['location'] == '冷冻' ? '冷冻' : '冷藏', 'purchaseDate' => item['purchaseDate'].to_s.match?(/\A\d{4}-\d{2}-\d{2}\z/) ? item['purchaseDate'] : today, 'freshness' => freshness }
  end.compact
  raise '没有识别到食材，请换一种说法。' if items.empty?
  { 'items' => items }
rescue Net::OpenTimeout, Net::ReadTimeout
  raise 'DeepSeek 请求超时，请稍后重试。'
rescue SocketError
  raise '无法连接 DeepSeek 服务，请检查网络。'
rescue JSON::ParserError
  raise '模型返回格式异常，请重试。'
end

def recognize_inventory_photo(image_data)
  api_key = ENV['DEEPSEEK_API_KEY']
  raise '未找到 DEEPSEEK_API_KEY，请先配置。' if api_key.to_s.empty?
  raise '图片格式不支持。' unless image_data.to_s.match?(%r{\Adata:image/(jpeg|png|gif|webp);base64,}i)
  raise '图片过大，请选择 8MB 以内的图片。' if image_data.bytesize > 11_000_000
  today = Time.now.strftime('%Y-%m-%d')
  prompt = "这是家庭冰箱食材录入：图片里的食材通常已经历采摘或生产、运输、仓储和零售，不能按刚采摘状态判断新鲜度。识别食材并只返回JSON：{\"items\":[{\"name\":\"食材名\",\"quantity\":1,\"unit\":\"个\",\"estimatedGrams\":150,\"location\":\"冷藏\",\"purchaseDate\":\"#{today}\",\"freshness\":\"新鲜\"}]}。结合食材性质、可见外观状态、冷藏或冷冻条件和日期，保守判断家庭冰箱剩余可食用期；freshness只能是新鲜、尽快食用、不宜食用。无法判断数量默认1、单位用常用家庭单位、位置默认冷藏、日期默认#{today}。不要把餐具或包装袋识别为食材，最多20条，不输出解释或Markdown。"
  uri = URI('https://api.deepseek.com/chat/completions')
  http = Net::HTTP.new(uri.host, uri.port)
  http.use_ssl = true
  http.verify_mode = OpenSSL::SSL::VERIFY_PEER
  http.open_timeout = 15
  http.read_timeout = 90
  request = Net::HTTP::Post.new(uri)
  request['Content-Type'] = 'application/json'
  request['Authorization'] = "Bearer #{api_key}"
  request.body = JSON.generate(model: ENV.fetch('DEEPSEEK_VISION_MODEL', 'deepseek-flash'), temperature: 0.1, max_tokens: 1400, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image_data, detail: 'high' } }] }])
  response = http.request(request)
  payload = JSON.parse(response.body)
  raise(payload.dig('error', 'message') || "DeepSeek 图片识别失败（#{response.code}）") unless response.is_a?(Net::HTTPSuccess)
  result = JSON.parse(payload.dig('choices', 0, 'message', 'content').to_s)
  items = Array(result['items']).first(20).map do |item|
    name = item['name'].to_s.strip
    next if name.empty?
    freshness = %w[新鲜 尽快食用 不宜食用].include?(item['freshness']) ? item['freshness'] : '新鲜'
    { 'name' => name, 'quantity' => [item['quantity'].to_f, 0.1].max, 'unit' => item['unit'].to_s.strip.empty? ? '个' : item['unit'].to_s.strip, 'estimatedGrams' => [item['estimatedGrams'].to_f, 0].max.round, 'location' => item['location'] == '冷冻' ? '冷冻' : '冷藏', 'purchaseDate' => item['purchaseDate'].to_s.match?(/\A\d{4}-\d{2}-\d{2}\z/) ? item['purchaseDate'] : today, 'freshness' => freshness }
  end.compact
  raise '没有识别到可录入的食材，请换一张更清晰的图片。' if items.empty?
  { 'items' => items }
rescue Net::OpenTimeout, Net::ReadTimeout
  raise 'DeepSeek 图片识别超时，请稍后重试。'
rescue SocketError
  raise '无法连接 DeepSeek 服务，请检查网络。'
rescue JSON::ParserError
  raise '模型返回格式异常，请重试。'
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

    if req.path == '/api/ai-inventory' && req.request_method == 'POST'
      body = request_json(req)
      text = body && body['text'].to_s.strip
      raise '请输入需要放入冰箱的食材。' if text.empty?
      json_response(res, 200, parse_inventory_with_deepseek(text))
      next
    end

    if req.path == '/api/photo-inventory' && req.request_method == 'POST'
      body = request_json(req)
      image = body && body['image'].to_s
      raise '请先拍照或选择图片。' if image.empty?
      json_response(res, 200, recognize_inventory_photo(image))
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
    elsif req.path.match?(%r{\A/assets/recipes/[a-z0-9-]+\.jpg\z})
      file_path = File.join(ROOT, req.path.sub(%r{\A/}, ''))
    elsif req.path.match?(%r{\A/(app\.js|styles\.css|food_knowledge\.json)\z})
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
    res['Content-Type'] = file_path.end_with?('.css') ? 'text/css; charset=utf-8' : file_path.end_with?('.js') ? 'application/javascript; charset=utf-8' : file_path.end_with?('.jpg') ? 'image/jpeg' : file_path.end_with?('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'
    res.body = File.read(file_path)
  rescue StandardError => e
    json_response(res, 422, { error: e.message })
  end
end

puts "智能厨房管家已启动：http://127.0.0.1:#{server.config[:Port]}"
server.start
