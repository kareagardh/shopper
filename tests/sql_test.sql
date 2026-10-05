\set ON_ERROR_STOP 1
select set_admin_password('hemligt-losen-123');
set role anon;
select admin_login('fel') as wrong;
select admin_login('hemligt-losen-123') as ok;
select admin_save_event('hemligt-losen-123', '{"date":"2026-10-04","name":"Höstloppis","commission_pct":10,"commission_min":30,"active":true,"station_code":"sol42"}') as ev;
select get_active_event() is not null as has_active;
-- direct table access must fail
do $$ begin perform * from carts; raise exception 'TABLE ACCESS SHOULD FAIL'; exception when insufficient_privilege then raise notice 'table access denied: ok'; end $$;
do $$ begin perform set_admin_password('xxxxxxxxxxxx'); raise exception 'SHOULD FAIL'; exception when insufficient_privilege then raise notice 'set_admin_password denied: ok'; end $$;
-- customer submits
select submit_cart('{"id":"11111111-1111-4111-8111-111111111111","code":"BL-AAAA","created":"1790000000000","done":"1790000600000","items":[{"s":112,"p":40,"t":1790000100000},{"s":45,"p":20},{"s":112,"p":25}]}') as c1;
select submit_cart('{"id":"11111111-1111-4111-8111-111111111111","code":"BL-AAAA","done":"1790000900000","items":[{"s":112,"p":40},{"s":45,"p":20}]}') as c1_again;
select submit_cart('{"id":"bad","code":"x","items":[]}') as bad_id;
select submit_cart('{"id":"22222222-2222-4222-8222-222222222222","code":"BL-B","items":[{"s":0,"p":10}]}') as bad_seller;
select submit_cart('{"id":"22222222-2222-4222-8222-222222222222","code":"BL-B","items":[{"s":5,"p":"1.5"}]}') as bad_price;
-- station
select station_login('fel', 1) as st_wrong;
select station_login('sol42', 9) as st_badnum;
select (station_login('sol42', 1))::jsonb->>'ok' as st_ok;
select station_sync((get_active_event()->>'id')::uuid, 'sol42', 1,
  '[{"id":"11111111-1111-4111-8111-111111111111","code":"BL-AAAA","checked":"1790000950000","method":"swish","items":[{"s":112,"p":40},{"s":45,"p":20}]},
    {"id":"33333333-3333-4333-8333-333333333333","code":"BL-CCCC","checked":"1790001000000","method":"kontant","items":[{"s":7,"p":100},{"s":8,"p":500}]},
    {"id":"nope","code":"BL-X","method":"swish","items":[{"s":1,"p":1}]}]') as sync;
-- customer later submits for a station-first cart: replaces items, keeps check
select submit_cart('{"id":"33333333-3333-4333-8333-333333333333","code":"BL-CCCC","items":[{"s":7,"p":100},{"s":8,"p":500},{"s":9,"p":20}]}') as c3;
reset role;
select code, total_sek, item_count, done_at is not null done, checked_station, checked_method, checked_total from carts order by code;
set role anon;
select json_build_object('sellers', (admin_data('hemligt-losen-123', null))::json->'sellers', 'stations', (admin_data('hemligt-losen-123', null))::json->'stations')::text as admin;
