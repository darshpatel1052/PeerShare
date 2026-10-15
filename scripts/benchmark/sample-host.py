#!/usr/bin/env python3
"""Read bounded cgroup/host counters; never logs SQL, credentials or user data."""
import json
from pathlib import Path
import subprocess
import time
names=['peerscreen-benchmark-bench-api-1','peerscreen-benchmark-bench-api-2','peerscreen-benchmark-bench-gateway-1','peerscreen-postgres-1','peerscreen-redis-1','peerscreen-redis-cache-1']
containers=[]
for name in names:
 try:
  pid=int(subprocess.check_output(['docker','inspect','-f','{{.State.Pid}}',name],text=True,stderr=subprocess.DEVNULL))
  path=Path('/sys/fs/cgroup')/Path('/proc/'+str(pid)+'/cgroup').read_text().split('::',1)[1].strip().lstrip('/')
  containers.append((name,path))
 except Exception:
  pass
previous={}
for _ in range(1800):
 now=time.monotonic();sample={'at':time.time(),'containers':{}}
 for name,path in containers:
  try:
   values=dict(line.split() for line in (path/'cpu.stat').read_text().splitlines());cpu=int(values['usage_usec']);old=previous.get(name)
   events=dict(line.split() for line in (path/'memory.events').read_text().splitlines())
   sample['containers'][name]={'cpuPercentOfOneCore':None if not old else (cpu-old[0])/(now-old[1])/10000,'memoryBytes':int((path/'memory.current').read_text()),'oomKills':int(events.get('oom_kill',0)),'throttledMicroseconds':int(values.get('throttled_usec',0))}
   previous[name]=(cpu,now)
  except (FileNotFoundError,ProcessLookupError):
   sample['containers'][name]={'stopped':True}
 sample['hostCPU']=list(map(int,Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
 memory=dict((line.split(':',1)[0],line.split(':',1)[1].strip()) for line in Path('/proc/meminfo').read_text().splitlines())
 sample['hostAvailableMemoryKiB']=int(memory['MemAvailable'].split()[0]);print(json.dumps(sample),flush=True);time.sleep(2)
