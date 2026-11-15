# Exercise the real request handler in process: no listening port, no live inventory.
require 'tmpdir'
require 'webrick'
require 'json'
require 'ostruct'
require 'minitest/autorun'
TASK_TMP = Dir.mktmpdir('recipe-test-')
ENV['DATA_PATH'] = File.join(TASK_TMP, 'inventory.json')
ENV['FOOD_KNOWLEDGE_SUPPLEMENT_PATH'] = File.join(TASK_TMP, 'food_knowledge_supplement.json')
class InProcessServer
  attr_accessor :handler
  def mount_proc(_path, &block); @handler = block; end
  def start; end
  def shutdown; end
  def config; {Port: 0}; end
end
TEST_SERVER = InProcessServer.new
WEBrick::HTTPServer.define_singleton_method(:new) { |**_options| TEST_SERVER }
load File.expand_path('../server.rb', __dir__)
class RecipeServerTest < Minitest::Test
  def test_recipe_adapter_uses_main_freshness_without_changing_the_record
    item = {'name'=>'西兰花','quantity'=>1,'unit'=>'颗','location'=>'冷藏','purchaseDate'=>'2020-01-01','freshness'=>'新鲜'}
    original = Marshal.load(Marshal.dump(item))
    assert_equal '不宜食用', recipe_stock_freshness(item, on: Date.new(2026,11,8))
    assert_equal original, item
    assert_equal '不宜食用', recipe_stock_freshness({'name'=>'鸡蛋','status'=>'待确认'})
  end

  def test_main_and_recipe_assets_are_both_served_with_correct_mime
    paths = {'/food_knowledge.json'=>'application/json','/recipe.html'=>'text/html','/recipe-app.js'=>'application/javascript','/recipe-host.js'=>'application/javascript','/recipe-frame.js'=>'application/javascript','/recipe-styles.css'=>'text/css','/assets/recipes/tomato-egg.jpg'=>'image/jpeg'}
    paths.each do |path, mime|
      req = OpenStruct.new(path:path,request_method:'GET')
      res = WEBrick::HTTPResponse.new(WEBrick::Config::HTTP)
      TEST_SERVER.handler.call(req,res)
      assert_equal 200,res.status,path
      assert_includes res['Content-Type'],mime,path
      refute_empty res.body,path
    end
  end

  def test_main_inventory_ai_routes_remain_available
    status, body = call('/api/ai-inventory',{'text'=>''})
    assert_equal 422,status
    assert_match '请输入需要放入冰箱',body['error']
    status, body = call('/api/photo-inventory',{'image'=>''})
    assert_equal 422,status
    assert_match '请先拍照或选择图片',body['error']
  end
  def test_explore_request_does_not_send_inventory_as_selection_criteria
    original_key = ENV['DEEPSEEK_API_KEY']
    ENV['DEEPSEEK_API_KEY'] = 'test-key'
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout, :captured
      def request(request)
        self.captured = JSON.parse(request.body)
        raise 'captured test request'
      end
    end
    state = {'inventory'=>[{'name'=>'鸡蛋','quantity'=>2,'unit'=>'个'},{'name'=>'牛肉','status'=>'状态存疑'}], 'preferences'=>{'avoid'=>['香菜']}}
    options = {'meal'=>'dinner','servings'=>2,'duration'=>30,'mode'=>'explore'}
    Net::HTTP.stub(:new, client) { assert_raises(RuntimeError) { recommend_recipes(options, state) } }
    context = JSON.parse(client.captured['messages'].last['content'])
    assert_empty context['available_inventory']
    assert_empty context['unavailable_inventory']
    assert_equal ['香菜'], context['avoid']
    options['mode'] = 'use-first'
    Net::HTTP.stub(:new, client) { assert_raises(RuntimeError) { recommend_recipes(options, state) } }
    context = JSON.parse(client.captured['messages'].last['content'])
    assert_equal '鸡蛋', context['available_inventory'].first['name']
    assert_equal '牛肉', context['unavailable_inventory'].first['name']
  ensure
    ENV['DEEPSEEK_API_KEY'] = original_key
  end
  def setup
    File.write(DATA_PATH, File.read(SEED_PATH))
    File.delete(FOOD_KNOWLEDGE_SUPPLEMENT_PATH) if File.exist?(FOOD_KNOWLEDGE_SUPPLEMENT_PATH)
  end
  def call(path, body = nil, method = 'POST')
    req = OpenStruct.new(path: path, request_method: method, body: JSON.generate(body))
    res = WEBrick::HTTPResponse.new(WEBrick::Config::HTTP)
    TEST_SERVER.handler.call(req, res)
    [res.status, JSON.parse(res.body)]
  end
  def stock(id = 'inv-egg'); read_state['inventory'].find { |i| i['id'] == id }; end
  def cook(id = 'one', item = stock, used = 2, extras = {})
    call('/api/cook', {operationId: id, recipe: {title: '测试餐'}, consumption: [{inventoryId: item['id'], quantity: used, expectedQuantity: item['quantity'], expectedItem: item, basis: 'estimated'}]}.merge(extras))
  end
  def test_sync_skips_unknown_or_invalid_purchase_amounts
    state = read_state
    state['shopping'] = [
      {'id'=>'unknown', 'name'=>'西兰花', 'quantity'=>nil, 'unit'=>'颗', 'status'=>'bought'},
      {'id'=>'vague', 'name'=>'盐', 'quantity'=>1, 'unit'=>'适量', 'status'=>'bought'},
      {'id'=>'known', 'name'=>'土豆', 'quantity'=>2, 'unit'=>'个', 'status'=>'bought'}
    ]
    write_state(state)
    status, result = call('/api/sync-shopping', {ids: %w[unknown vague known]})
    assert_equal 200, status
    assert_equal ['known'], result['inventory'].map { |item| item['sourceShoppingId'] }.compact
    assert_equal 'bought', result['shopping'].find { |item| item['id']=='unknown' }['status']
    assert_equal 'bought', result['shopping'].find { |item| item['id']=='vague' }['status']
    assert_equal 'archived', result['shopping'].find { |item| item['id']=='known' }['status']
  end

  def test_ai_confirmed_knowledge_only_supplements_and_never_overwrites_formal_values
    items = [
      {'name'=>'番茄','aliases'=>['红果'],'categoryTag'=>'肉类','quantity'=>2,'unit'=>'个','estimatedGrams'=>1998,'location'=>'冷冻'},
      {'name'=>'罗马花椰菜','aliases'=>['宝塔菜'],'categoryTag'=>'蔬菜','quantity'=>1,'unit'=>'颗','estimatedGrams'=>500,'location'=>'冷藏'}
    ]
    status, result = call('/api/food-knowledge/supplement', {'items'=>items})
    assert_equal 200, status
    assert_equal 1, result['added']
    assert_equal 1, result['updated']

    req = OpenStruct.new(path:'/food_knowledge.json',request_method:'GET',body:'')
    res = WEBrick::HTTPResponse.new(WEBrick::Config::HTTP)
    TEST_SERVER.handler.call(req,res)
    knowledge = JSON.parse(res.body)
    tomato = knowledge['foods'].find { |food| food['canonical_name']=='西红柿' }
    assert_equal '蔬菜', tomato['category_tag']
    assert_equal 150.0, tomato['units']['个']
    assert_includes tomato['common_names'], '红果'
    romanesco = knowledge['foods'].find { |food| food['canonical_name']=='罗马花椰菜' }
    assert_equal '蔬菜', romanesco['category_tag']
    assert_equal 500.0, romanesco['units']['颗']
    assert_equal 'refrigerated', romanesco['default_storage']
    refute romanesco.key?('freshness_standard')
  end
  def test_serpapi_search_returns_safe_source_and_keeps_key_private
    previous = ENV['IMAGE_API_KEY']
    ENV['IMAGE_API_KEY'] = 'test-key'
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout, :request_uri
      def request(request)
        self.request_uri = request.path
        response = Net::HTTPOK.new('1.1', '200', 'OK')
        response.instance_variable_set(:@read, true)
        response.body = JSON.generate(images_results: [
          {original:'javascript:bad', link:'https://example.com/a'},
          {original:'https://example.com/food.jpg', link:'https://example.com/recipe', source:'美食网站', title:'番茄炒蛋'}
        ])
        response
      end
    end
    status, result = Net::HTTP.stub(:new, client) { call('/api/recipe-image', {title:'番茄炒蛋'}) }
    assert_equal 200, status
    assert_equal 'web-search', result['imageType']
    assert_equal 'https://example.com/food.jpg', result['imageUrl']
    assert_equal 'https://example.com/recipe', result['imageSourceUrl']
    assert_equal '美食网站', result['imageSource']
    assert_equal '授权待核对', result['imageLicense']
    assert_includes client.request_uri, 'engine=google_images'
    refute_includes JSON.generate(result), 'test-key'
  ensure
    ENV['IMAGE_API_KEY'] = previous
  end
  def test_serpapi_without_key_returns_clear_error
    previous = ENV['IMAGE_API_KEY']
    ENV['IMAGE_API_KEY'] = ''
    status, result = call('/api/recipe-image', {title:'测试'})
    assert_equal 422, status
    assert_match(/未配置 SerpApi/, result['error'])
  ensure
    ENV['IMAGE_API_KEY'] = previous
  end
  def test_serpapi_unauthorized_does_not_leak_key
    previous = ENV['IMAGE_API_KEY']
    ENV['IMAGE_API_KEY'] = 'private-test-key'
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout
      def request(_request); Net::HTTPUnauthorized.new('1.1', '401', 'Unauthorized'); end
    end
    status, result = Net::HTTP.stub(:new, client) { call('/api/recipe-image', {title:'测试'}) }
    assert_equal 422, status
    assert_match(/SerpApi.*401/, result['error'])
    refute_includes result['error'], 'private-test-key'
  ensure
    ENV['IMAGE_API_KEY'] = previous
  end
  def test_import_text_uses_deepseek_and_preserves_unknown_quantities
    previous = ENV['DEEPSEEK_API_KEY']; ENV['DEEPSEEK_API_KEY'] = 'test-key'
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout, :body
      def request(request)
        self.body = JSON.parse(request.body)
        result = {title:'番茄炒蛋', ingredients:[{name:'番茄',quantity:2,unit:'个'},{name:'盐',quantity:nil,unit:'适量'}], auxiliaries:[], seasonings:[], steps:['切番茄','炒熟鸡蛋后加入番茄'], duration:nil, servings:nil, appliances:[], uncertainties:[]}
        response = Net::HTTPOK.new('1.1','200','OK'); response.instance_variable_set(:@read,true)
        response.body = JSON.generate(choices:[{message:{content:JSON.generate(result)}}]);response
      end
    end
    status, result = Net::HTTP.stub(:new,client) { call('/api/recipe-import/parse',{sourceText:'番茄2个，盐适量。切番茄，炒熟鸡蛋后加入番茄。 https://example.com/recipe'}) }
    assert_equal 200,status
    assert_equal '番茄炒蛋',result['title']
    assert_equal 2,result['steps'].length
    assert_nil result['ingredients'][1]['quantity']
    assert_nil result['duration']
    assert_equal 'json_object',client.body['response_format']['type']
    assert_equal '番茄2个，盐适量。切番茄，炒熟鸡蛋后加入番茄。', client.body['messages'].last['content']
    refute_includes JSON.generate(result),'test-key'
  ensure
    ENV['DEEPSEEK_API_KEY'] = previous
  end
  def test_favorite_cover_saves_jpeg_for_the_link_card
    original_key = ENV['OPENAI_IMAGE_API_KEY']
    ENV['OPENAI_IMAGE_API_KEY'] = 'image-test-key'
    jpeg = File.binread(File.expand_path('../assets/recipes/tomato-egg.jpg', __dir__))
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout, :payload, :path, :jpeg
      def request(request)
        self.payload = JSON.parse(request.body)
        self.path = request.path
        response = Net::HTTPOK.new('1.1', '200', 'OK')
        response.instance_variable_set(:@read, true)
        response.body = JSON.generate(data: [{b64_json: Base64.strict_encode64(jpeg)}])
        response
      end
    end
    client.jpeg = jpeg
    status, result = Net::HTTP.stub(:new, client) do
      call('/api/favorite-cover', {title:'番茄炒蛋', sourceUrl:'https://xhslink.com/example'})
    end
    assert_equal 200, status
    assert_equal '/v1/images/generations', client.path
    assert_includes client.payload['prompt'], '番茄炒蛋'
    refute_includes JSON.generate(client.payload), 'xhslink.com'
    req = OpenStruct.new(path:result['imageUrl'], request_method:'GET')
    res = WEBrick::HTTPResponse.new(WEBrick::Config::HTTP)
    TEST_SERVER.handler.call(req, res)
    assert_equal 200, res.status
    assert_equal jpeg, res.body
  ensure
    ENV['OPENAI_IMAGE_API_KEY'] = original_key
  end

  def test_import_link_only_requests_prompt_to_open_platform_without_fetching
    unexpected_http = ->(*) { flunk 'A link-only request must not start an HTTP request' }
    Net::HTTP.stub(:new, unexpected_http) do
      ['https://xhslink.com/example', 'https://v.douyin.com/example/'].each do |url|
        status, result = call('/api/recipe-import/parse', {sourceUrl: url})
        assert_equal 422, status
        assert_match(/原平台打开/, result['error'])
      end
      status, result = call('/api/recipe-import/parse', {sourceText: 'https://xhslink.com/example'})
      assert_equal 422, status
      assert_match(/菜谱正文/, result['error'])
    end
  end
  def test_connection_refused_has_clear_error
    previous = ENV['DEEPSEEK_API_KEY']
    ENV['DEEPSEEK_API_KEY'] = 'test-key'
    client = Object.new
    class << client
      attr_accessor :use_ssl, :verify_mode, :open_timeout, :read_timeout
      def request(_request); raise Errno::ECONNREFUSED; end
    end
    status, result = Net::HTTP.stub(:new, client) { call('/api/recipe-recommendation', {meal:'dinner',servings:2,duration:30,mode:'explore'}) }
    assert_equal 422, status
    assert_equal '无法连接菜谱 AI 服务，请检查网络。', result['error']
  ensure
    ENV['DEEPSEEK_API_KEY'] = previous
  end
  def test_reference_idempotent_and_undo
    before = stock
    assert_equal 200, cook.first
    assert_equal 4, stock['quantity']
    assert_equal 'estimated', stock['quantityBasis']
    assert_equal before['quantity'], stock['lastConfirmedQuantity']
    assert_equal 200, cook('one', before).first
    assert_equal 4, stock['quantity']
    assert_equal 200, call('/api/cook/undo', {operationId: 'one'}).first
    assert_equal before, stock
    assert_equal 200, call('/api/cook/undo', {operationId: 'one'}).first
    assert_equal before, stock
  end
  def test_changed_date_or_status_rejects_entire_transaction
    old = stock
    s = read_state; s['inventory'].find { |i| i['id'] == old['id'] }['expiryDate'] = '2028-01-01'; write_state(s)
    assert_equal 422, cook('stale', old).first
    assert_equal 6, stock['quantity']
  end
  def test_no_negative_inventory_and_unknown_quantity
    assert_equal 422, cook('too-much', stock, 100).first
    assert_equal 6, stock['quantity']
    assert_equal 422, cook('negative', stock, -1).first
    assert_equal 6, stock['quantity']
  end
  def test_calibration_replaces_estimate_without_extra_deduction
    assert_equal 200, cook.first
    assert_equal 200, call('/api/cook', {operationId: 'calibrate', consumption: [], calibrations: [{inventoryId: 'inv-egg', remaining: 5, expectedItem: stock}]}).first
    assert_equal 5, stock['quantity']
    assert_equal 'confirmed', stock['quantityBasis']
    assert_equal 5, stock['lastConfirmedQuantity']
    assert_equal 422, call('/api/cook/undo', {operationId: 'one'}).first
    assert_equal 5, stock['quantity']
    assert_equal 200, call('/api/cook/undo', {operationId: 'calibrate'}).first
    assert_equal 4, stock['quantity']
  end
  def test_new_purchase_leftover_keeps_old_batch_and_is_idempotent
    old = stock('inv-chicken')
    addition = old.merge('id'=>'new-batch','quantity'=>80,'expiryDate'=>'','quantityBasis'=>'confirmed','sourceShoppingId'=>'purchase-new')
    body = {operationId: 'new', consumption: [], additions: [addition]}
    assert_equal 200, call('/api/cook', body).first
    assert_equal old, stock('inv-chicken')
    assert_equal 80, stock('new-batch')['quantity']
    assert_equal 200, call('/api/cook', body).first
    assert_equal 1, read_state['inventory'].count { |i| i['id']=='new-batch' }
    assert_equal 422, call('/api/cook', body.merge(operationId:'duplicate-purchase',additions:[addition.merge('id'=>'other-batch')])).first
    assert_equal 200, call('/api/cook/undo', {operationId:'new'}).first
    assert_nil stock('new-batch')
  end
  def test_used_purchase_does_not_sync_the_original_quantity_and_can_be_undone
    state = read_state
    purchase = {'id'=>'fresh-eggs', 'name'=>'鸡蛋', 'unit'=>'个', 'quantity'=>6, 'status'=>'bought'}
    state['shopping'] << purchase
    write_state(state)
    body = {operationId:'external-only', externalConsumption:[
      {name:'鸡蛋', unit:'个', quantity:2, remaining:0, basis:'estimated', purchaseId:purchase['id'], expectedPurchase:purchase}
    ]}
    before = stock
    assert_equal 200, call('/api/cook', body).first
    assert_equal 200, call('/api/cook', body).first
    assert_equal 'archived', read_state['shopping'].find { |item| item['id'] == purchase['id'] }['status']
    assert_equal 200, call('/api/sync-shopping', {ids:[purchase['id']]}).first
    assert_equal before, stock
    refute read_state['inventory'].any? { |item| item['sourceShoppingId'] == purchase['id'] }
    assert_equal 200, call('/api/cook/undo', {operationId:'external-only'}).first
    assert_equal purchase, read_state['shopping'].find { |item| item['id'] == purchase['id'] }
  end
  def test_external_leftover_can_be_recorded_without_a_quantity_when_not_stocking
    line = {name:'番茄', unit:'个', quantity:2, remaining:nil, hasRemaining:true, basis:'estimated'}
    before = read_state['inventory']
    assert_equal 200, call('/api/cook', {operationId:'external-remaining', externalConsumption:[line]}).first
    assert_equal before, read_state['inventory']
    recorded = read_state['history'].last['externalConsumption'].first
    assert_equal true, recorded['hasRemaining']
    assert_nil recorded['remaining']
    assert_equal 422, call('/api/cook', {operationId:'invalid-remaining', externalConsumption:[line.merge(hasRemaining:false)]}).first
  end
  def test_unattributed_leftover_adds_only_new_stock_and_rejects_existing_stock
    line = {name:'嫩豆腐', unit:'克', remaining:100, hasRemaining:true}
    addition = {id:'tofu-leftover', name:'嫩豆腐', unit:'克', quantity:100, origin:'meal-leftover'}
    body = {operationId:'unattributed-leftover', unattributedLeftovers:[line], additions:[addition]}
    assert_equal 200, call('/api/cook', body).first
    assert_equal 100, stock('tofu-leftover')['quantity']
    assert_empty read_state['history'].last['externalConsumption']
    assert_equal 100, read_state['history'].last['unattributedLeftovers'].first['remaining']
    assert_equal 422, call('/api/cook', body.merge(operationId:'other', additions:[addition.merge(id:'duplicate')])).first
    assert_equal 200, call('/api/cook/undo', {operationId:'unattributed-leftover'}).first
    assert_nil stock('tofu-leftover')
  end
  def test_mixed_source_uses_only_explicit_old_amount
    assert_equal 200, cook('mixed',stock('inv-chicken'),100,quantityBasis:'confirmed').first
    assert_equal 200, stock('inv-chicken')['quantity']
    assert_equal 6, stock['quantity']
  end
  def test_stale_put_cannot_restore_consumed_stock
    old = read_state
    assert_equal 200, cook.first
    assert_equal 422, call('/api/state',{state:old},'PUT').first
    assert_equal 4, stock['quantity']
  end
  def test_undo_cannot_override_later_independent_edits
    cook
    s = read_state; s['inventory'].find { |i| i['id']=='inv-egg' }['freshness']='状态存疑';write_state(s)
    assert_equal 422, call('/api/cook/undo',{operationId:'one'}).first
    assert_equal '状态存疑', stock['freshness']
  end
  def test_zero_calibration_and_empty_operation
    assert_equal 200, call('/api/cook',{operationId:'zero',calibrations:[{inventoryId:'inv-egg',remaining:0,expectedItem:stock}]}).first
    assert_nil stock
    assert_equal 200, call('/api/cook/undo',{operationId:'zero'}).first
    assert_equal 6, stock['quantity']
    assert_equal 200, call('/api/cook',{operationId:'nothing',consumption:[],additions:[]}).first
    assert_equal true, read_state.dig('mealPlan','lastCompleted','consumedNothing')
  end
end
