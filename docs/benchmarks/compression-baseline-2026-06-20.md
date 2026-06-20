# CacheLane Tool Output Compression Benchmark compression-local

Generated: 2026-06-20T19:42:04.600Z
Model: claude-opus-4-7
Config: warmup=100, iterations=1000, json_array_limit=20

## Summary

- Estimated JSON tokens before: 8535
- Estimated JSON tokens after: 5705
- Estimated JSON tokens saved: 2830
- Estimated JSON reduction ratio: 33.2%
- JSON latency p50/p95/p99: 0.951 / 2.243 / 3.519 ms
- Lossless JSON semantic equal: true
- Lossless JSON latency p50/p95/p99: 0.683 / 1.527 / 2.263 ms
- Estimated balanced JSON tokens before: 8535
- Estimated balanced JSON tokens after: 5705
- Estimated balanced JSON tokens saved: 2830
- Estimated balanced JSON reduction ratio: 33.2%
- Balanced JSON latency p50/p95/p99: 0.906 / 2.289 / 3.536 ms
- Estimated log tokens before: 7800
- Estimated log tokens after: 5701
- Estimated log tokens saved: 2099
- Estimated log reduction ratio: 26.9%
- Log latency p50/p95/p99: 0.318 / 0.731 / 1.189 ms

## Validation

- JSON parse valid: true
- Lossless JSON parse valid: true
- Lossless JSON semantic equal: true
- Balanced JSON parse valid: true
- JSON reduced: true
- Balanced JSON reduced: true
- Log reduced: true
- JSON pipeline saved tokens: true
- Balanced JSON pipeline saved tokens: true
- Log pipeline saved tokens: true
- JSON p99 under 5ms: true
- Lossless JSON p99 under 5ms: true
- Balanced JSON p99 under 5ms: true
- Log p99 under 5ms: true

## JSON Compression (Aggressive)

Original tokens: 8535 (estimated)
Compressed tokens: 5705 (estimated)
Tokens saved: 2830 (estimated)
Reduction ratio: 33.2%
Latency p50/p95/p99: 0.951 / 2.243 / 3.519 ms

Compressed JSON preview:
```json
{"field_1":{"id":1,"label":"item-1","nested":{"keep":true}},"field_3":{"id":3,"label":"item-3","nested":{"keep":true}},"field_5":{"id":5,"label":"item-5"},"field_7":{"id":7,"label":"item-7","nested":{"keep":true}},"field_9":{"id":9,"label":"item-9","nested":{"keep":true}},"field_11":{"id":11,"label":"item-11","nested":{"keep":true}},"field_13":{"id":13,"label":"item-13","nested":{"keep":true}},"field_15":{"id":15,"label":"item-15"},"field_17":{"id":17,"label":"item-17","nested":{"keep":true}},"field_19":{"id":19,"label":"item-19","nested":{"keep":true}},"field_21":{"id":21,"label":"item-21","nested":{"keep":true}},"field_23":{"id":23,"label":"item-23","nested":{"keep":true}},"field_25":{"id":25,"label":"item-25"},"field_27":{"id":27,"label":"item-27","nested":{"keep":true}},"field_29":{"id":29,"label":"item-29","nested":{"keep":true}},"field_31":{"id":31,"label":"item-31","nested":{"keep":true}},"field_33":{"id":33,"label":"item-33","nested":{"keep":true}},"field_35":{"id":35,"label":"item-35"},"field_37":{"id":37,"label":"item-37","nested":{"keep":true}},"field_39":{"id":39,"label":"item-39","nested":{"keep":true}},"field_41":{"id":41,"label":"item-41","nested":{"keep":true}},"field_43":{"id":43,"label":"item-43","nested":{"keep":true}},"field_45":{"id":45,"label":"item-45"},"field_47":{"id":47,"label":"item-47","nested":{"keep":true}},"field_49":{"id":49,"label":"item-49","nested":{"keep":true}},"field_51":{"id":51,"label":"item-51","nested":{"keep":true}},"field_53":{"id":53,"label":"item-53","nested":{"keep":true}},"field_55":{"id":55,"label":"item-55"},"field_57":{"id":57,"label":"item-57","nested":{"keep":true}},"field_59":{"id":59,"label":"item-59","nested":{"keep":true}},"field_61":{"id":61,"label":"item-61","nested":{"keep":true}},"field_63":{"id":63,"label":"item-63","nested":{"keep":true}},"field_65":{"id":65,"label":"item-65"},"field_67":{"id":67,"label":"item-67","nested":{"keep":true}},"field_69":{"id":69,"label":"item-69","nested":{"keep":true}},"field_71":{"id":71,"label":"item-71","nested":{"keep":true}},"field_73":{"id":73,"label":"item-73","nested":{"keep":true}},"field_75":{"id":75,"label":"item-75"},"field_77":{"id":77,"label":"item-77","nested":{"keep":true}},"field_79":{"id":79,"label":"item-79","nested":{"keep":true}},"field_81":{"id":81,"label":"item-81","nested":{"keep":true}},"field_83":{"id":83,"label":"item-83","nested":{"keep":true}},"field_85":{"id":85,"label":"item-85"},"field_87":{"id":87,"label":"item-87","nested":{"keep":true}},"field_89":{"id":89,"label":"item-89","nested":{"keep":true}},"field_91":{"id":91,"label":"item-91","nested":{"keep":true}},"field_93":{"id":93,"label":"item-93","nested":{"keep":true}},"field_95":{"id":95,"label":"item-95"},"field_97":{"id":97,"label":"item-97","nested":{"keep":true}},"field_99":{"id":99,"label":"item-99","nested":{"keep":true}},"field_101":{"id":101,"label":"item-101","nested":{"keep":true}},"field_103":{"id":103,"label":"item-103","nested":{"keep":true}},"field_105":{"id":105,"label":"item-105"},"field_107":{"id":107,"label":"item-107","nested":{"keep":true}},"field_109":{"id":109,"label":"item-109","nested":{"keep":true}},"field_111":{"id":111,"label":"item-111","nested":{"keep":true}},"field_113":{"id":113,"label":"item-113","nested":{"keep":true}},"field_115":{"id":115,"label":"item-115"},"field_117":{"id":117,"label":"item-117","nested":{"keep":true}},"field_119":{"id":119,"label":"item-119","nested":{"keep":true}},"field_121":{"id":121,"label":"item-121","nested":{"keep":true}},"field_123":{"id":123,"label":"item-123","nested":{"keep":true}},"field_125":{"id":125,"label":"item-125"},"field_127":{"id":127,"label":"item-127","nested":{"keep":true}},"field_129":{"id":129,"label":"item-129","nested":{"keep":true}},"field_131":{"id":131,"label":"item-131","nested":{"keep":true}},"field_133":{"id":133,"label":"item-133","nested":{"keep":true}},"field_135":{"id":135,"label":"item-135"},"field_137":{"id":137,"label":"item-137","nested":{"keep":true}},"field_139":{"id":139,"label":"item-139","nested":{"keep":true}},"field_141":{"id":141,"label":"item-141","nested":{"keep":true}},"field_143":{"id":143,"label":"item-143","nested":{"keep":true}},"field_145":{"id":145,"label":"item-145"},"field_147":{"id":147,"label":"item-147","nested":{"keep":true}},"field_149":{"id":149,"label":"item-149","nested":{"keep":true}},"field_151":{"id":151,"label":"item-151","nested":{"keep":true}},"field_153":{"id":153,"label":"item-153","nested":{"keep":true}},"field_155":{"id":155,"label":"item-155"},"field_157":{"id":157,"label":"item-157","nested":{"keep":true}},"field_159":{"id":159,"label":"item-159","nested":{"keep":true}},"field_161":{"id":161,"label":"item-161","nested":{"keep":true}},"field_163":{"id":163,"label":"item-163","nested":{"keep":true}},"field_165":{"id":165,"label":"item-165"},"field_167":{"id":167,"label":"item-167","nested":{"keep":true}},"field_169":{"id":169,"label":"item-169","nested":{"keep":true}},"field_171":{"id":171,"label":"item-171","nested":{"keep":true}},"field_173":{"id":173,"label":"item-173","nested":{"keep":true}},"field_175":{"id":175,"label":"item-175"},"field_177":{"id":177,"label":"item-177","nested":{"keep":true}},"field_179":{"id":179,"label":"item-179","nested":{"keep":true}},"field_181":{"id":181,"label":"item-181","nested":{"keep":true}},"field_183":{"id":183,"label":"item-183","nested":{"keep":true}},"field_185":{"id":185,"label":"item-185"},"field_187":{"id":187,"label":"item-187","nested":{"keep":true}},"field_189":{"id":189,"label":"item-189","nested":{"keep":true}},"field_191":{"id":191,"label":"item-191","nested":{"keep":true}},"field_193":{"id":193,"label":"item-193","nested":{"keep":true}},"field_195":{"id":195,"label":"item-195"},"field_197":{"id":197,"label":"item-197","nested":{"keep":true}},"field_199":{"id":199,"label":"item-199","nested":{"keep":true}},"field_201":{"id":201,"label":"item-201","nested":{"keep":true}},"field_203":{"id":203,"label":"item-203","nested":{"keep":true}},"field_205":{"id":205,"label":"item-205"},"field_207":{"id":207,"label":"item-207","nested":{"keep":true}},"field_209":{"id":209,"label":"item-209","nested":{"keep":true}},"field_211":{"id":211,"label":"item-211","nested":{"keep":true}},"field_213":{"id":213,"label":"item-213","nested":{"keep":true}},"field_215":{"id":215,"label":"item-215"},"field_217":{"id":217,"label":"item-217","nested":{"keep":true}},"field_219":{"id":219,"label":"item-219","nested":{"keep":true}},"field_221":{"id":221,"label":"item-221","nested":{"keep":true}},"field_223":{"id":223,"label":"item-223","nested":{"keep":true}},"field_225":{"id":225,"label":"item-225"},"field_227":{"id":227,"label":"item-227","nested":{"keep":true}},"field_229":{"id":229,"label":"item-229","nested":{"keep":true}},"field_231":{"id":231,"label":"item-231","nested":{"keep":true}},"field_233":{"id":233,"label":"item-233","nested":{"keep":true}},"field_235":{"id":235,"label":"item-235"},"field_237":{"id":237,"label":"item-237","nested":{"keep":true}},"field_239":{"id":239,"label":"item-239","nested":{"keep":true}},"field_241":{"id":241,"label":"item-241","nested":{"keep":true}},"field_243":{"id":243,"label":"item-243","nested":{"keep":true}},"field_245":{"id":245,"label":"item-245"},"field_247":{"id":247,"label":"item-247","nested":{"keep":true}},"field_249":{"id":249,"label":"item-249","nested":{"keep":true}},"field_251":{"id":251,"label":"item-251","nested":{"keep":true}},"field_253":{"id":253,"label":"item-253","nested":{"keep":true}},"field_255":{"id":255,"label":"item-255"},"field_257":{"id":257,"label":"item-257","nested":{"keep":true}},"field_259":{"id":259,"label":"item-259","nested":{"keep":true}},"field_261":{"id":261,"label":"item-261","nested":{"keep":true}},"field_263":{"id":263,"label":"item-263","nested":{"keep":true}},"field_265":{"id":265,"label":"item-265"},"field_267":{"id":267,"label":"item-267","nested":{"keep":true}},"field_269":{"id":269,"label":"item-269","nested":{"keep":true}},"field_271":{"id":271,"label":"item-271","nested":{"keep":true}},"field_273":{"id":273,"label":"item-273","nested":{"keep":true}},"field_275":{"id":275,"label":"item-275"},"field_277":{"id":277,"label":"item-277","nested":{"keep":true}},"field_279":{"id":279,"label":"item-279","nested":{"keep":true}},"field_281":{"id":281,"label":"item-281","nested":{"keep":true}},"field_283":{"id":283,"label":"item-283","nested":{"keep":true}},"field_285":{"id":285,"label":"item-285"},"field_287":{"id":287,"label":"item-287","nested":{"keep":true}},"field_289":{"id":289,"label":"item-289","nested":{"keep":true}},"field_291":{"id":291,"label":"item-291","nested":{"keep":true}},"field_293":{"id":293,"label":"item-293","nested":{"keep":true}},"field_295":{"id":295,"label":"item-295"},"field_297":{"id":297,"label":"item-297","nested":{"keep":true}},"field_299":{"id":299,"label":"item-299","nested":{"keep":true}},"field_301":{"id":301,"label":"item-301","nested":{"keep":true}},"field_303":{"id":303,"label":"item-303","nested":{"keep":true}},"field_305":{"id":305,"label":"item-305"},"field_307":{"id":307,"label":"item-307","nested":{"keep":true}},"field_309":{"id":309,"label":"item-309","nested":{"keep":true}},"field_311":{"id":311,"label":"item-311","nested":{"keep":true}},"field_313":{"id":313,"label":"item-313","nested":{"keep":true}},"field_315":{"id":315,"label":"item-315"},"field_317":{"id":317,"label":"item-317","nested":{"keep":true}},"field_319":{"id":319,"label":"item-319","nested":{"keep":true}},"field_321":{"id":321,"label":"item-321","nested":{"keep":true}},"field_323":{"id":323,"label":"item-323","nested":{"keep":true}},"field_325":{"id":325,"label":"item-325"},"field_327":{"id":327,"label":"item-327","nested":{"keep":true}},"field_329":{"id":329,"label":"item-329","nested":{"keep":true}},"field_331":{"id":331,"label":"item-331","nested":{"keep":true}},"field_333":{"id":333,"label":"item-333","nested":{"keep":true}},"field_335":{"id":335,"label":"item-335"},"field_337":{"id":337,"label":"item-337","nested":{"keep":true}},"field_339":{"id":339,"label":"item-339","nested":{"keep":true}},"field_341":{"id":341,"label":"item-341","nested":{"keep":true}},"field_343":{"id":343,"label":"item-343","nested":{"keep":true}},"field_345":{"id":345,"label":"item-345"},"field_347":{"id":347,"label":"item-347","nested":{"keep":true}},"field_349":{"id":349,"label":"item-349","nested":{"keep":true}},"field_351":{"id":351,"label":"item-351","nested":{"keep":true}},"field_353":{"id":353,"label":"item-353","nested":{"keep":true}},"field_355":{"id":355,"label":"item-355"},"field_357":{"id":357,"label":"item-357","nested":{"keep":true}},"field_359":{"id":359,"label":"item-359","nested":{"keep":true}},"field_361":{"id":361,"label":"item-361","nested":{"keep":true}},"field_363":{"id":363,"label":"item-363","nested":{"keep":true}},"field_365":{"id":365,"label":"item-365"},"field_367":{"id":367,"label":"item-367","nested":{"keep":true}},"field_369":{"id":369,"label":"item-369","nested":{"keep":true}},"field_371":{"id":371,"label":"item-371","nested":{"keep":true}},"field_373":{"id":373,"label":"item-373","nested":{"keep":true}},"field_375":{"id":375,"label":"item-375"},"field_377":{"id":377,"label":"item-377","nested":{"keep":true}},"field_379":{"id":379,"label":"item-379","nested":{"keep":true}},"field_381":{"id":381,"label":"item-381","nested":{"keep":true}},"field_383":{"id":383,"label":"item-383","nested":{"keep":true}},"field_385":{"id":385,"label":"item-385"},"field_387":{"id":387,"label":"item-387","nested":{"keep":true}},"field_389":{"id":389,"label":"item-389","nested":{"keep":true}},"field_391":{"id":391,"label":"item-391","nested":{"keep":true}},"field_393":{"id":393,"label":"item-393","nested":{"keep":true}},"field_395":{"id":395,"label":"item-395"},"field_397":{"id":397,"label":"item-397","nested":{"keep":true}},"field_399":{"id":399,"label":"item-399","nested":{"keep":true}},"field_401":{"id":401,"label":"item-401","nested":{"keep":true}},"field_403":{"id":403,"label":"item-403","nested":{"keep":true}},"field_405":{"id":405,"label":"item-405"},"field_407":{"id":407,"label":"item-407","nested":{"keep":true}},"field_409":{"id":409,"label":"item-409","nested":{"keep":true}},"field_411":{"id":411,"label":"item-411","nested":{"keep":true}},"field_413":{"id":413,"label":"item-413","nested":{"keep":true}},"field_415":{"id":415,"label":"item-415"},"field_417":{"id":417,"label":"item-417","nested":{"keep":true}},"field_419":{"id":419,"label":"item-419","nested":{"keep":true}},"field_421":{"id":421,"label":"item-421","nested":{"keep":true}},"field_423":{"id":423,"label":"item-423","nested":{"keep":true}},"field_425":{"id":425,"label":"item-425"},"field_427":{"id":427,"label":"item-427","nested":{"keep":true}},"field_429":{"id":429,"label":"item-429","nested":{"keep":true}},"field_431":{"id":431,"label":"item-431","nested":{"keep":true}},"field_433":{"id":433,"label":"item-433","nested":{"keep":true}},"field_435":{"id":435,"label":"item-435"},"field_437":{"id":437,"label":"item-437","nested":{"keep":true}},"field_439":{"id":439,"label":"item-439","nested":{"keep":true}},"field_441":{"id":441,"label":"item-441","nested":{"keep":true}},"field_443":{"id":443,"label":"item-443","nested":{"keep":true}},"field_445":{"id":445,"label":"item-445"},"field_447":{"id":447,"label":"item-447","nested":{"keep":true}},"field_449":{"id":449,"label":"item-449","nested":{"keep":true}},"field_451":{"id":451,"label":"item-451","nested":{"keep":true}},"field_453":{"id":453,"label":"item-453","nested":{"keep":true}},"field_455":{"id":455,"label":"item-455"},"field_457":{"id":457,"label":"item-457","nested":{"keep":true}},"field_459":{"id":459,"label":"item-459","nested":{"keep":true}},"field_461":{"id":461,"label":"item-461","nested":{"keep":true}},"field_463":{"id":463,"label":"item-463","nested":{"keep":true}},"field_465":{"id":465,"label":"item-465"},"field_467":{"id":467,"label":"item-467","nested":{"keep":true}},"field_469":{"id":469,"label":"item-469","nested":{"keep":true}},"field_471":{"id":471,"label":"item-471","nested":{"keep":true}},"field_473":{"id":473,"label":"item-473","nested":{"keep":true}},"field_475":{"id":475,"label":"item-475"},"field_477":{"id":477,"label":"item-477","nested":{"keep":true}},"field_479":{"id":479,"label":"item-479","nested":{"keep":true}},"field_481":{"id":481,"label":"item-481","nested":{"keep":true}},"field_483":{"id":483,"label":"item-483","nested":{"keep":true}},"field_485":{"id":485,"label":"item-485"},"field_487":{"id":487,"label":"item-487","nested":{"keep":true}},"field_489":{"id":489,"label":"item-489","nested":{"keep":true}},"field_491":{"id":491,"label":"item-491","nested":{"keep":true}},"field_493":{"id":493,"label":"item-493","nested":{"keep":true}},"field_495":{"id":495,"label":"item-495"},"field_497":{"id":497,"label":"item-497","nested":{"keep":true}},"field_499":{"id":499,"label":"item-499","nested":{"keep":true}},"metadata":{"source":"synthetic","keep":"yes"}}
```

## JSON Compression (Lossless)

Original tokens: 8535 (estimated)
Compressed tokens: 8535 (estimated)
Tokens saved: 0 (estimated)
Semantic equal: true
Latency p50/p95/p99: 0.683 / 1.527 / 2.263 ms

## JSON Compression (Balanced)

Original tokens: 8535 (estimated)
Compressed tokens: 5705 (estimated)
Tokens saved: 2830 (estimated)
Reduction ratio: 33.2%
Latency p50/p95/p99: 0.906 / 2.289 / 3.536 ms

## Log Compression

Original tokens: 7800 (estimated)
Compressed tokens: 5701 (estimated)
Tokens saved: 2099 (estimated)
Reduction ratio: 26.9%
Latency p50/p95/p99: 0.318 / 0.731 / 1.189 ms

Compressed log preview:
```text
FIRST LINE
2026-06-20T12:00:00Z ERROR task-0 failed
2026-06-20T12:02:00Z ERROR task-2 failed
2026-06-20T12:04:00Z ERROR task-4 failed
WARN retry 5
2026-06-20T12:06:00Z ERROR task-6 failed
2026-06-20T12:08:00Z ERROR task-8 failed
2026-06-20T12:10:00Z ERROR task-10 failed
2026-06-20T12:12:00Z ERROR task-12 failed
2026-06-20T12:14:00Z ERROR task-14 failed
WARN retry 15
2026-06-20T12:16:00Z ERROR task-16 failed
2026-06-20T12:18:00Z ERROR task-18 failed
2026-06-20T12:20:00Z ERROR task-20 failed
2026-06-20T12:22:00Z ERROR task-22 failed
2026-06-20T12:24:00Z ERROR task-24 failed
WARN retry 25
2026-06-20T12:26:00Z ERROR task-26 failed
2026-06-20T12:28:00Z ERROR task-28 failed
2026-06-20T12:30:00Z ERROR task-30 failed
2026-06-20T12:32:00Z ERROR task-32 failed
2026-06-20T12:34:00Z ERROR task-34 failed
WARN retry 35
2026-06-20T12:36:00Z ERROR task-36 failed
2026-06-20T12:38:00Z ERROR task-38 failed
2026-06-20T12:40:00Z ERROR task-40 failed
2026-06-20T12:42:00Z ERROR task-42 failed
2026-06-20T12:44:00Z ERROR task-44 failed
WARN retry 45
2026-06-20T12:46:00Z ERROR task-46 failed
2026-06-20T12:48:00Z ERROR task-48 failed
2026-06-20T12:50:00Z ERROR task-50 failed
2026-06-20T12:52:00Z ERROR task-52 failed
2026-06-20T12:54:00Z ERROR task-54 failed
WARN retry 55
2026-06-20T12:56:00Z ERROR task-56 failed
2026-06-20T12:58:00Z ERROR task-58 failed
2026-06-20T12:00:00Z ERROR task-60 failed
2026-06-20T12:02:00Z ERROR task-62 failed
2026-06-20T12:04:00Z ERROR task-64 failed
WARN retry 65
2026-06-20T12:06:00Z ERROR task-66 failed
2026-06-20T12:08:00Z ERROR task-68 failed
2026-06-20T12:10:00Z ERROR task-70 failed
2026-06-20T12:12:00Z ERROR task-72 failed
2026-06-20T12:14:00Z ERROR task-74 failed
WARN retry 75
2026-06-20T12:16:00Z ERROR task-76 failed
2026-06-20T12:18:00Z ERROR task-78 failed
2026-06-20T12:20:00Z ERROR task-80 failed
2026-06-20T12:22:00Z ERROR task-82 failed
2026-06-20T12:24:00Z ERROR task-84 failed
WARN retry 85
2026-06-20T12:26:00Z ERROR task-86 failed
2026-06-20T12:28:00Z ERROR task-88 failed
2026-06-20T12:30:00Z ERROR task-90 failed
2026-06-20T12:32:00Z ERROR task-92 failed
2026-06-20T12:34:00Z ERROR task-94 failed
WARN retry 95
2026-06-20T12:36:00Z ERROR task-96 failed
2026-06-20T12:38:00Z ERROR task-98 failed
2026-06-20T12:40:00Z ERROR task-100 failed
2026-06-20T12:42:00Z ERROR task-102 failed
2026-06-20T12:44:00Z ERROR task-104 failed
WARN retry 105
2026-06-20T12:46:00Z ERROR task-106 failed
2026-06-20T12:48:00Z ERROR task-108 failed
2026-06-20T12:50:00Z ERROR task-110 failed
2026-06-20T12:52:00Z ERROR task-112 failed
2026-06-20T12:54:00Z ERROR task-114 failed
WARN retry 115
2026-06-20T12:56:00Z ERROR task-116 failed
2026-06-20T12:58:00Z ERROR task-118 failed
2026-06-20T12:00:00Z ERROR task-120 failed
2026-06-20T12:02:00Z ERROR task-122 failed
2026-06-20T12:04:00Z ERROR task-124 failed
WARN retry 125
2026-06-20T12:06:00Z ERROR task-126 failed
2026-06-20T12:08:00Z ERROR task-128 failed
2026-06-20T12:10:00Z ERROR task-130 failed
2026-06-20T12:12:00Z ERROR task-132 failed
2026-06-20T12:14:00Z ERROR task-134 failed
WARN retry 135
2026-06-20T12:16:00Z ERROR task-136 failed
2026-06-20T12:18:00Z ERROR task-138 failed
2026-06-20T12:20:00Z ERROR task-140 failed
2026-06-20T12:22:00Z ERROR task-142 failed
2026-06-20T12:24:00Z ERROR task-144 failed
WARN retry 145
2026-06-20T12:26:00Z ERROR task-146 failed
2026-06-20T12:28:00Z ERROR task-148 failed
2026-06-20T12:30:00Z ERROR task-150 failed
2026-06-20T12:32:00Z ERROR task-152 failed
2026-06-20T12:34:00Z ERROR task-154 failed
WARN retry 155
2026-06-20T12:36:00Z ERROR task-156 failed
2026-06-20T12:38:00Z ERROR task-158 failed
2026-06-20T12:40:00Z ERROR task-160 failed
2026-06-20T12:42:00Z ERROR task-162 failed
2026-06-20T12:44:00Z ERROR task-164 failed
WARN retry 165
2026-06-20T12:46:00Z ERROR task-166 failed
2026-06-20T12:48:00Z ERROR task-168 failed
2026-06-20T12:50:00Z ERROR task-170 failed
2026-06-20T12:52:00Z ERROR task-172 failed
2026-06-20T12:54:00Z ERROR task-174 failed
WARN retry 175
2026-06-20T12:56:00Z ERROR task-176 failed
2026-06-20T12:58:00Z ERROR task-178 failed
2026-06-20T12:00:00Z ERROR task-180 failed
2026-06-20T12:02:00Z ERROR task-182 failed
2026-06-20T12:04:00Z ERROR task-184 failed
WARN retry 185
2026-06-20T12:06:00Z ERROR task-186 failed
2026-06-20T12:08:00Z ERROR task-188 failed
2026-06-20T12:10:00Z ERROR task-190 failed
2026-06-20T12:12:00Z ERROR task-192 failed
2026-06-20T12:14:00Z ERROR task-194 failed
WARN retry 195
2026-06-20T12:16:00Z ERROR task-196 failed
2026-06-20T12:18:00Z ERROR task-198 failed
2026-06-20T12:20:00Z ERROR task-200 failed
2026-06-20T12:22:00Z ERROR task-202 failed
2026-06-20T12:24:00Z ERROR task-204 failed
WARN retry 205
2026-06-20T12:26:00Z ERROR task-206 failed
2026-06-20T12:28:00Z ERROR task-208 failed
2026-06-20T12:30:00Z ERROR task-210 failed
2026-06-20T12:32:00Z ERROR task-212 failed
2026-06-20T12:34:00Z ERROR task-214 failed
WARN retry 215
2026-06-20T12:36:00Z ERROR task-216 failed
2026-06-20T12:38:00Z ERROR task-218 failed
2026-06-20T12:40:00Z ERROR task-220 failed
2026-06-20T12:42:00Z ERROR task-222 failed
2026-06-20T12:44:00Z ERROR task-224 failed
WARN retry 225
2026-06-20T12:46:00Z ERROR task-226 failed
2026-06-20T12:48:00Z ERROR task-228 failed
2026-06-20T12:50:00Z ERROR task-230 failed
2026-06-20T12:52:00Z ERROR task-232 failed
2026-06-20T12:54:00Z ERROR task-234 failed
WARN retry 235
2026-06-20T12:56:00Z ERROR task-236 failed
2026-06-20T12:58:00Z ERROR task-238 failed
2026-06-20T12:00:00Z ERROR task-240 failed
2026-06-20T12:02:00Z ERROR task-242 failed
2026-06-20T12:04:00Z ERROR task-244 failed
WARN retry 245
2026-06-20T12:06:00Z ERROR task-246 failed
2026-06-20T12:08:00Z ERROR task-248 failed
2026-06-20T12:10:00Z ERROR task-250 failed
2026-06-20T12:12:00Z ERROR task-252 failed
2026-06-20T12:14:00Z ERROR task-254 failed
WARN retry 255
2026-06-20T12:16:00Z ERROR task-256 failed
2026-06-20T12:18:00Z ERROR task-258 failed
2026-06-20T12:20:00Z ERROR task-260 failed
2026-06-20T12:22:00Z ERROR task-262 failed
2026-06-20T12:24:00Z ERROR task-264 failed
WARN retry 265
2026-06-20T12:26:00Z ERROR task-266 failed
2026-06-20T12:28:00Z ERROR task-268 failed
2026-06-20T12:30:00Z ERROR task-270 failed
2026-06-20T12:32:00Z ERROR task-272 failed
2026-06-20T12:34:00Z ERROR task-274 failed
WARN retry 275
2026-06-20T12:36:00Z ERROR task-276 failed
2026-06-20T12:38:00Z ERROR task-278 failed
2026-06-20T12:40:00Z ERROR task-280 failed
2026-06-20T12:42:00Z ERROR task-282 failed
2026-06-20T12:44:00Z ERROR task-284 failed
WARN retry 285
2026-06-20T12:46:00Z ERROR task-286 failed
2026-06-20T12:48:00Z ERROR task-288 failed
2026-06-20T12:50:00Z ERROR task-290 failed
2026-06-20T12:52:00Z ERROR task-292 failed
2026-06-20T12:54:00Z ERROR task-294 failed
WARN retry 295
2026-06-20T12:56:00Z ERROR task-296 failed
2026-06-20T12:58:00Z ERROR task-298 failed
2026-06-20T12:00:00Z ERROR task-300 failed
2026-06-20T12:02:00Z ERROR task-302 failed
2026-06-20T12:04:00Z ERROR task-304 failed
WARN retry 305
2026-06-20T12:06:00Z ERROR task-306 failed
2026-06-20T12:08:00Z ERROR task-308 failed
2026-06-20T12:10:00Z ERROR task-310 failed
2026-06-20T12:12:00Z ERROR task-312 failed
2026-06-20T12:14:00Z ERROR task-314 failed
WARN retry 315
2026-06-20T12:16:00Z ERROR task-316 failed
2026-06-20T12:18:00Z ERROR task-318 failed
2026-06-20T12:20:00Z ERROR task-320 failed
2026-06-20T12:22:00Z ERROR task-322 failed
2026-06-20T12:24:00Z ERROR task-324 failed
WARN retry 325
2026-06-20T12:26:00Z ERROR task-326 failed
2026-06-20T12:28:00Z ERROR task-328 failed
2026-06-20T12:30:00Z ERROR task-330 failed
2026-06-20T12:32:00Z ERROR task-332 failed
2026-06-20T12:34:00Z ERROR task-334 failed
WARN retry 335
2026-06-20T12:36:00Z ERROR task-336 failed
2026-06-20T12:38:00Z ERROR task-338 failed
2026-06-20T12:40:00Z ERROR task-340 failed
2026-06-20T12:42:00Z ERROR task-342 failed
2026-06-20T12:44:00Z ERROR task-344 failed
WARN retry 345
2026-06-20T12:46:00Z ERROR task-346 failed
2026-06-20T12:48:00Z ERROR task-348 failed
2026-06-20T12:50:00Z ERROR task-350 failed
2026-06-20T12:52:00Z ERROR task-352 failed
2026-06-20T12:54:00Z ERROR task-354 failed
WARN retry 355
2026-06-20T12:56:00Z ERROR task-356 failed
2026-06-20T12:58:00Z ERROR task-358 failed
2026-06-20T12:00:00Z ERROR task-360 failed
2026-06-20T12:02:00Z ERROR task-362 failed
2026-06-20T12:04:00Z ERROR task-364 failed
WARN retry 365
2026-06-20T12:06:00Z ERROR task-366 failed
2026-06-20T12:08:00Z ERROR task-368 failed
2026-06-20T12:10:00Z ERROR task-370 failed
2026-06-20T12:12:00Z ERROR task-372 failed
2026-06-20T12:14:00Z ERROR task-374 failed
WARN retry 375
2026-06-20T12:16:00Z ERROR task-376 failed
2026-06-20T12:18:00Z ERROR task-378 failed
2026-06-20T12:20:00Z ERROR task-380 failed
2026-06-20T12:22:00Z ERROR task-382 failed
2026-06-20T12:24:00Z ERROR task-384 failed
WARN retry 385
2026-06-20T12:26:00Z ERROR task-386 failed
2026-06-20T12:28:00Z ERROR task-388 failed
2026-06-20T12:30:00Z ERROR task-390 failed
2026-06-20T12:32:00Z ERROR task-392 failed
2026-06-20T12:34:00Z ERROR task-394 failed
WARN retry 395
2026-06-20T12:36:00Z ERROR task-396 failed
2026-06-20T12:38:00Z ERROR task-398 failed
2026-06-20T12:40:00Z ERROR task-400 failed
2026-06-20T12:42:00Z ERROR task-402 failed
2026-06-20T12:44:00Z ERROR task-404 failed
WARN retry 405
2026-06-20T12:46:00Z ERROR task-406 failed
2026-06-20T12:48:00Z ERROR task-408 failed
2026-06-20T12:50:00Z ERROR task-410 failed
2026-06-20T12:52:00Z ERROR task-412 failed
2026-06-20T12:54:00Z ERROR task-414 failed
WARN retry 415
2026-06-20T12:56:00Z ERROR task-416 failed
2026-06-20T12:58:00Z ERROR task-418 failed
2026-06-20T12:00:00Z ERROR task-420 failed
2026-06-20T12:02:00Z ERROR task-422 failed
2026-06-20T12:04:00Z ERROR task-424 failed
WARN retry 425
2026-06-20T12:06:00Z ERROR task-426 failed
2026-06-20T12:08:00Z ERROR task-428 failed
2026-06-20T12:10:00Z ERROR task-430 failed
2026-06-20T12:12:00Z ERROR task-432 failed
2026-06-20T12:14:00Z ERROR task-434 failed
WARN retry 435
2026-06-20T12:16:00Z ERROR task-436 failed
2026-06-20T12:18:00Z ERROR task-438 failed
2026-06-20T12:20:00Z ERROR task-440 failed
2026-06-20T12:22:00Z ERROR task-442 failed
2026-06-20T12:24:00Z ERROR task-444 failed
WARN retry 445
2026-06-20T12:26:00Z ERROR task-446 failed
2026-06-20T12:28:00Z ERROR task-448 failed
2026-06-20T12:30:00Z ERROR task-450 failed
2026-06-20T12:32:00Z ERROR task-452 failed
2026-06-20T12:34:00Z ERROR task-454 failed
WARN retry 455
2026-06-20T12:36:00Z ERROR task-456 failed
2026-06-20T12:38:00Z ERROR task-458 failed
2026-06-20T12:40:00Z ERROR task-460 failed
2026-06-20T12:42:00Z ERROR task-462 failed
2026-06-20T12:44:00Z ERROR task-464 failed
WARN retry 465
2026-06-20T12:46:00Z ERROR task-466 failed
2026-06-20T12:48:00Z ERROR task-468 failed
2026-06-20T12:50:00Z ERROR task-470 failed
2026-06-20T12:52:00Z ERROR task-472 failed
2026-06-20T12:54:00Z ERROR task-474 failed
WARN retry 475
2026-06-20T12:56:00Z ERROR task-476 failed
2026-06-20T12:58:00Z ERROR task-478 failed
2026-06-20T12:00:00Z ERROR task-480 failed
2026-06-20T12:02:00Z ERROR task-482 failed
2026-06-20T12:04:00Z ERROR task-484 failed
WARN retry 485
2026-06-20T12:06:00Z ERROR task-486 failed
2026-06-20T12:08:00Z ERROR task-488 failed
2026-06-20T12:10:00Z ERROR task-490 failed
2026-06-20T12:12:00Z ERROR task-492 failed
2026-06-20T12:14:00Z ERROR task-494 failed
WARN retry 495
2026-06-20T12:16:00Z ERROR task-496 failed
2026-06-20T12:18:00Z ERROR task-498 failed
LAST LINE
```
