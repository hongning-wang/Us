User confirmed provider: https://www.seeddance.io/docs
POST https://www.seeddance.io/v1/videos/generations -> {task_id,status,created_at}
GET /v1/tasks/{task_id}. Model seedance-2.5. Bearer SEEDANCE_API_KEY.
Body: model,prompt,duration:5,quality:'480p',aspect_ratio:'9:16',image_urls:[],video_urls:[],reference_mode:true for identity reference photos (otherwise one photo is treated as first frame). Public HTTPS media required. Never substitute 2.0.
User asks to conserve credits/tokens VERY carefully. Live verification is limited to one successful render per required flow; fixtures/mocks cover UI changes; no automatic generation retries. Single bounded live calls only after all local paths work.

Live 2.5 compatibility: on 2026-09-19 the documented one-image `reference_mode:true` request was rejected as mixed frame/reference input, without creating a task. For one or two confirmed identity images, the adapter repeats the same identity image to fill three image-reference slots and uses automatic reference mode. Text and continuation both succeeded with this request. It never supplies the sender’s likeness as the friend.
