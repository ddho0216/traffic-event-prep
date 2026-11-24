import cv2, numpy as np, sys
from PIL import Image
def toon(src, dst, k=14, edge=True, scale=1.0, lw=2):
    im=np.array(Image.open(src).convert('RGBA')); rgb=im[:,:,:3]; a=im[:,:,3]
    if scale!=1: 
        rgb=cv2.resize(rgb,None,fx=scale,fy=scale,interpolation=cv2.INTER_CUBIC); a=cv2.resize(a,None,fx=scale,fy=scale,interpolation=cv2.INTER_NEAREST)
    sm=rgb.copy()
    for _ in range(3): sm=cv2.bilateralFilter(sm,9,40,7)
    Z=sm.reshape(-1,3).astype(np.float32); mask=(a.reshape(-1)>40)
    crit=(cv2.TERM_CRITERIA_EPS+cv2.TERM_CRITERIA_MAX_ITER,20,1.0)
    _,lab,cen=cv2.kmeans(Z[mask],k,None,crit,3,cv2.KMEANS_PP_CENTERS)
    q=Z.copy(); q[mask]=cen[lab.flatten()]; q=q.reshape(sm.shape).astype(np.uint8)
    # 살짝 채도 올리기
    hsv=cv2.cvtColor(q,cv2.COLOR_RGB2HSV).astype(np.int16); hsv[:,:,1]=np.clip(hsv[:,:,1]*1.12,0,255); q=cv2.cvtColor(hsv.astype(np.uint8),cv2.COLOR_HSV2RGB)
    out=q.copy()
    if edge:
        g=cv2.cvtColor(sm,cv2.COLOR_RGB2GRAY); e=cv2.Canny(g,30,80)
        e=cv2.dilate(e,np.ones((lw,lw),np.uint8))
        out[e>0]=(29,23,18)
    if a.min()<255:
        ol=cv2.dilate((a>40).astype(np.uint8),np.ones((3,3),np.uint8))-(cv2.erode((a>40).astype(np.uint8),np.ones((3,3),np.uint8)))
        out[ol>0]=(29,23,18)
    Image.fromarray(np.dstack([out,a])).save(dst,quality=92,method=6)
args=sys.argv[1:]
toon(args[0],args[1],int(args[2]),args[3]=='1',float(args[4]),int(args[5]))
