# Exercise the real request handler in process: no listening port, no live inventory.
require 'tmpdir'
require 'webrick'
require 'json'
require 'ostruct'
require 'minitest/autorun'
TASK_TMP = Dir.mktmpdir('recipe-test-')
ENV['DATA_PATH'] = File.join(TASK_TMP, 'inventory.json')
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
    status, result = Net::HTTP.stub(:new,client) { call('/api/recipe-import/parse',{sourceText:'番茄2个，盐适量。切番茄，炒熟鸡蛋后加入番茄。'}) }
    assert_equal 200,status
    assert_equal '番茄炒蛋',result['title']
    assert_equal 2,result['steps'].length
    assert_nil result['ingredients'][1]['quantity']
    assert_nil result['duration']
    assert_equal 'json_object',client.body['response_format']['type']
    refute_includes JSON.generate(result),'test-key'
  ensure
    ENV['DEEPSEEK_API_KEY'] = previous
  end
  def test_import_rejects_local_and_unsupported_url
    previous = ENV['DEEPSEEK_API_KEY']; ENV['DEEPSEEK_API_KEY'] = 'test-key'
    status, result = call('/api/recipe-import/parse',{sourceUrl:'http://127.0.0.1/private'})
    assert_equal 422,status
    assert_match(/HTTPS/,result['error'])
    status, result = call('/api/recipe-import/parse',{sourceUrl:'https://example.com/recipe'})
    assert_equal 422,status
    assert_match(/粘贴菜谱正文/,result['error'])
  ensure
    ENV['DEEPSEEK_API_KEY'] = previous
  end
  def test_import_link_rejects_private_addresses
    error = Resolv.stub(:getaddresses, ['127.0.0.1']) { assert_raises(RuntimeError) { fetch_recipe_text('https://xhslink.com/test') } }
    assert_match(/无法安全读取/, error.message)
  end
  def test_import_does_not_treat_short_share_text_as_recipe_when_link_unavailable
    previous = ENV['DEEPSEEK_API_KEY']; ENV['DEEPSEEK_API_KEY'] = 'test-key'
    error = stub(:fetch_recipe_text, ->(_url) { raise '链接无法读取' }) do
      assert_raises(RuntimeError) { parse_imported_recipe({'sourceUrl'=>'https://xhslink.com/test','sourceText'=>'来看这个 https://xhslink.com/test'}) }
    end
    assert_equal '链接无法读取', error.message
  ensure
    ENV['DEEPSEEK_API_KEY'] = previous
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
