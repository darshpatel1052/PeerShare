"""Render report figures from preserved measurements; never substitute targets."""
import json
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
root = Path('docs/evidence/phase-6/benchmark/raw')
output = Path('docs/benchmarks/figures')
output.mkdir(parents=True, exist_ok=True)
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'axes.spines.top':False,'axes.spines.right':False,'figure.facecolor':'#f6f5f1','axes.facecolor':'#f6f5f1','axes.labelcolor':'#252b27','text.color':'#252b27','axes.titleweight':'bold','savefig.facecolor':'#f6f5f1'})
fig, axes = plt.subplots(1, 2, figsize=(12, 4.5), constrained_layout=True)
for run,label,color in [('baseline-v1','Baseline','#748277'),('optimized-v1','Optimized','#c63e25')]:
    values=[]
    for rate in [25,50,100,200,400]:
        path=root/run/f'step-{rate}'/'summary.json'
        if path.exists():
            data=json.loads(path.read_text()); values.append((rate,data['metrics']['operation_latency_ms']['values']['p(99)']))
    axes[0].plot([v[0] for v in values],[v[1] for v in values],marker='o',label=label,color=color,linewidth=2)
axes[0].set(xscale='log',yscale='log',xlabel='Offered API operations / second',ylabel='All-operation p99 (ms)',title='Catalogue load steps')
axes[0].set_xticks([25,50,100,200,400],['25','50','100','200','400']);axes[0].legend(frameon=False);axes[0].set_yticks([100,500,1000,5000],['100','500','1,000','5,000'])
axes[0].annotate('400/sec failed\n10.49% errors + 7,919 drops',xy=(400,5002),xytext=(-150,-35),textcoords='offset points',fontsize=8,arrowprops={'arrowstyle':'-','color':'#c63e25'})
steady=[json.loads((root/'optimized-v1'/f'steady-{i}'/'summary.json').read_text()) for i in [1,2,3]]
x=np.arange(3)
for offset,key,label,color in [(-.18,'p(95)','p95','#748277'),(.18,'p(99)','p99','#c63e25')]:
    vals=[s['metrics']['operation_latency_ms']['values'][key] for s in steady]
    bars=axes[1].bar(x+offset,vals,width=.34,label=label,color=color);axes[1].bar_label(bars,padding=4,fmt='%.0f ms',fontsize=9)
axes[1].set(xticks=x,xticklabels=['Trial 1','Trial 2','Trial 3'],ylabel='Validated operation latency (ms)',ylim=(0,125),title='200/sec · three 120-second trials');axes[1].legend(frameon=False)
fig.suptitle('100k metadata videos · 10k synthetic accounts · 2 vCPU / 8 GiB AWS host',fontsize=12)
fig.savefig(output/'catalogue.png',dpi=180);plt.close(fig)
pipeline=json.loads((root/'pipeline-v1'/'pipeline.json').read_text());jobs=pipeline['results'];labels=[];uploads=[];ready=[]
for i,job in enumerate(jobs):
    labels.append(job['profile'] if job['condition']=='sequential' else f'720p-30s · burst {i-2}')
    uploads.append(job['uploadMS']/1000);ready.append(job['processingWaitMS']/1000)
fig,ax=plt.subplots(figsize=(10,5),constrained_layout=True)
y=np.arange(len(jobs));ax.barh(y,uploads,color='#748277',label='Upload');ax.barh(y,ready,left=uploads,color='#c63e25',label='Upload completion → ready')
for i,(u,r) in enumerate(zip(uploads,ready)):ax.text(u+r+1,i,f'{u+r:.1f}s',va='center',fontsize=9)
ax.set(yticks=y,yticklabels=labels,xlabel='Wall-clock seconds (includes queueing, S3 and projection)',title='Seven real media jobs · fourteen adaptive HLS renditions',xlim=(0,120));ax.invert_yaxis();ax.legend(frameon=False,loc='lower right');fig.savefig(output/'media-pipeline.png',dpi=180);plt.close(fig)
peer=json.loads((root/'public-peers-v1'/'peer-comparison.json').read_text())
fig,ax=plt.subplots(figsize=(10,5))
fig.subplots_adjust(left=.1,right=.98,top=.88,bottom=.19)
x=np.arange(3)
http=[];playback=[];setup=[]
for i in [1,2,3]:
    h=next(r for r in peer['rounds'] if r['repeat']==i and r['mode']=='http-only')
    p=next(r for r in peer['rounds'] if r['repeat']==i and r['mode']=='peer-assisted')
    http.append(h['originMediaBodyBytes']/1e6);playback.append(p['originMediaBodyBytes']/1e6);setup.append(p['consentSetupBodyBytes']/1e6)
ax.bar(x-.18,http,width=.34,label='HTTP-only playback',color='#748277')
ax.bar(x+.18,playback,width=.34,label='Peer-assisted playback',color='#c63e25')
ax.bar(x+.18,setup,bottom=playback,width=.34,label='Sharing consent setup',color='#e9aa7d')
for i,(h,p,c) in enumerate(zip(http,playback,setup)):
    ax.text(i+.18,p+c+.5,f'{(1-(p+c)/h)*100:.1f}% less',ha='center',fontsize=9)
ax.set(xticks=x,xticklabels=['Pair 1','Pair 2','Pair 3'],ylabel='Origin media response-body MB (decimal)',ylim=(0,30),title='Eight browser contexts · 30-second clip · three comparisons')
ax.legend(frameon=False,loc='upper right',fontsize=9)
fig.text(.1,.035,'Includes sharing setup. One workstation; 23.6–29.2% dropped frames. Body bytes are not billed wire traffic.',fontsize=8)
fig.savefig(output/'peer-delivery.png',dpi=180);plt.close(fig)
print('Rendered three figures from preserved raw measurements.')
