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
