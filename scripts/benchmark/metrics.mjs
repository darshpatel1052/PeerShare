import { hostCommand } from "./host.mjs";
export async function snapshot(scope = "benchmark") {
  if (!["benchmark", "public"].includes(scope))
    throw Error("Invalid deployment metric scope");
  const prefix =
    scope === "benchmark"
      ? "peerscreen-benchmark-bench-api-"
      : "peerscreen-api-";
  const output = await hostCommand(`sudo python3 - <<'PY'
import json,subprocess,urllib.request
values={};replicas=[]
for n in (1,2):
 name='${prefix}'+str(n)
 ip=subprocess.check_output(['docker','inspect','--format','{{(index .NetworkSettings.Networks "peerscreen_default").IPAddress}}',name],text=True).strip()
 text=urllib.request.urlopen('http://'+ip+':8080/metrics',timeout=5).read().decode()
 for line in text.splitlines():
  if line.startswith(('peerscreen_analytics_cache_total{','peerscreen_http_response_body_bytes_total{','peerscreen_http_request_duration_seconds_count{')):
   key,value=line.rsplit(' ',1);values[key]=values.get(key,0)+float(value)
 replicas.append(name)
print(json.dumps({'replicas':replicas,'counters':values}))
PY
`);
  return { checkedAt: new Date().toISOString(), ...JSON.parse(output) };
}
