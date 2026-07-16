const H = {"X-PW-AccessToken":"f9c703e17516976a957bfb2205e694d2","X-PW-Application":"developer_api","X-PW-UserEmail":"hasankhadra2013@gmail.com","Content-Type":"application/json"};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function go(label, method, path, body) {
  const t = Date.now();
  try { const r = await fetch(`https://api.copper.com/developer_api/v1${path}`, { method, headers: H, body: body?JSON.stringify(body):undefined }); console.log(`${label}: HTTP ${r.status} (${Date.now()-t}ms)`); await r.text(); }
  catch (e) { console.log(`${label}: THREW ${e.name}: ${e.message} | cause=${e.cause?.code||e.cause?.message} (${Date.now()-t}ms)`); }
}
await go("GET pipelines (opens keepalive socket)", "GET", "/pipelines");
for (const wait of [30000, 40000, 50000]) {
  console.log(`...waiting ${wait/1000}s (socket idles)...`);
  await sleep(wait);
  await go(`POST search after ${wait/1000}s idle`, "POST", "/opportunities/search", {pipeline_ids:[1154463], page_size:200});
}
