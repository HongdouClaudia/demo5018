# Recipe-only adapter for main's food knowledge and freshness rules.
# It evaluates existing records; it never normalizes or rewrites stored inventory.
require 'date'

def recipe_stock_freshness(item, on: Date.today)
  unsafe = %w[不可食用 已确认不可食用 丢弃 变质 状态存疑 待确认 不宜食用]
  return '不宜食用' if unsafe.include?(item['status']) || unsafe.include?(item['freshness'])
  foods = (@recipe_food_knowledge ||= JSON.parse(File.read(File.join(ROOT, 'food_knowledge.json'))).fetch('foods'))
  food = foods.find { |entry| ([entry['canonical_name'], entry['name']] + Array(entry['common_names']) + Array(entry['aliases'])).include?(item['name']) }
  storage = item['location'] == '冷冻' ? 'frozen' : 'refrigerated'
  rules = food&.dig('freshness_standard', storage) || (storage == 'frozen' ? {'fresh'=>{'max_days'=>21}, 'consume_soon'=>{'max_days'=>60}} : {'fresh'=>{'max_days'=>1}, 'consume_soon'=>{'max_days'=>4}})
  stored = Date.iso8601((item['purchaseDate'] || item['createdAt'] || on.iso8601).to_s[0,10]) rescue on
  age = [(on - stored).to_i, 0].max
  result = age <= rules.dig('fresh','max_days') ? '新鲜' : age <= rules.dig('consume_soon','max_days') ? '尽快食用' : '不宜食用'
  severity = {'新鲜'=>0,'尽快食用'=>1,'不宜食用'=>2}
  ai = item['aiFreshness']
  severity.fetch(ai,0) > severity[result] ? ai : result
end
