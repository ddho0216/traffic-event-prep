import cv2, numpy as np
from PIL import Image
im=cv2.imread('images/9.jpg'); OUT='/home/user/traffic-event-prep/jeon-game/assets/'
B={ # (x0,y0,x1,y1)
 'flour_pancake':(0,40,228,248),'flour_rice':(228,40,458,248),'flour_fry':(458,40,688,248),
 'salt':(688,40,918,248),'pepper':(918,40,1148,248),'soy':(1148,40,1376,248),
 'oil_olive':(0,272,228,485),'oil_grape':(228,272,458,485),'oil_canola':(458,272,688,485),
 'bowl':(688,262,918,485),'board':(918,262,1148,485),'pan':(1148,262,1376,485),
 'spatula':(0,515,228,725),'whisk':(228,515,458,725),'plates':(458,515,608,725),'eggs':(608,515,758,725),
 'dish':(758,515,918,725),'ladle':(918,515,1060,725),'knife':(1060,515,1208,725),'towel':(1208,515,1376,725),
}
def cut(c, keep=1):
    h,w=c.shape[:2]
    hsv=cv2.cvtColor(c,cv2.COLOR_BGR2HSV); H,S,V=[hsv[:,:,i].astype(int) for i in range(3)]
    bg=np.median(np.concatenate([c[:3].reshape(-1,3),c[-3:].reshape(-1,3),c[:,:3].reshape(-1,3),c[:,-3:].reshape(-1,3)]),axis=0)
    d=np.abs(c.astype(int)-bg).sum(2)
    mask=np.full((h,w),cv2.GC_PR_BGD,np.uint8)
    colored=(S>45)&(d>45)
    bright=(V>178)
    dark=(V<62)
    mask[colored|bright|dark]=cv2.GC_PR_FGD
    mask[(S>70)&(d>80)]=cv2.GC_FGD
    shadow=(S<30)&(V>80)&(V<int(bg.mean())-8)
    mask[shadow&~dark]=cv2.GC_PR_BGD
    mask[:3,:]=mask[-3:,:]=cv2.GC_BGD; mask[:,:3]=mask[:,-3:]=cv2.GC_BGD
    bgm=np.zeros((1,65),np.float64); fgm=np.zeros((1,65),np.float64)
    cv2.grabCut(c,mask,None,bgm,fgm,6,cv2.GC_INIT_WITH_MASK)
    m=np.where((mask==1)|(mask==3),255,0).astype(np.uint8)
    m=cv2.morphologyEx(m,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    order=1+np.argsort(-st[1:,cv2.CC_STAT_AREA])
    out=[]
    for i in order[:keep]:
        mm=(lab==i).astype(np.uint8)*255
        ff=mm.copy(); mk=np.zeros((h+2,w+2),np.uint8); cv2.floodFill(ff,mk,(0,0),255); mm=mm|(255-ff)
        out.append(mm)
    return out
def save(c,m,name):
    ys,xs=np.where(m>0); x0,x1,y0,y1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
    rgba=np.dstack([c[y0:y1,x0:x1][:,:,::-1],m[y0:y1,x0:x1]])
    Image.fromarray(rgba).save(OUT+f'prop_{name}.webp',quality=92,method=6); return (x1-x0,y1-y0)
GRAY={'bowl':5,'knife':5,'pan':5,'pepper':5,'salt':5,'whisk':7,'soy':3,'towel':5,'ladle':3}
def outline_fill(c,k):
    h,w=c.shape[:2]
    ol=(c.max(2)<85).astype(np.uint8)*255
    ol=cv2.dilate(ol,np.ones((k,k),np.uint8))
    free=(255-ol).copy(); mk=np.zeros((h+2,w+2),np.uint8)
    for sx in range(0,w,7):
        for sy in (0,h-1):
            if free[sy,sx]==255: cv2.floodFill(free,mk,(sx,sy),128)
    for sy in range(0,h,7):
        for sx in (0,w-1):
            if free[sy,sx]==255: cv2.floodFill(free,mk,(sx,sy),128)
    m=(free!=128).astype(np.uint8)*255
    m=cv2.erode(m,np.ones((max(1,k//2),max(1,k//2)),np.uint8))
    n,lab,st,_=cv2.connectedComponentsWithStats(m)
    if n<2: return m
    i=1+np.argmax(st[1:,cv2.CC_STAT_AREA]); return (lab==i).astype(np.uint8)*255
for k,(x0,y0,x1,y1) in B.items():
    c=im[y0:y1,x0:x1]
    if k in GRAY and k!='towel':
        m=cut(c)[0]|outline_fill(c,GRAY[k])
        n2,lab,st,_=cv2.connectedComponentsWithStats(m); i=1+np.argmax(st[1:,cv2.CC_STAT_AREA]); m=(lab==i).astype(np.uint8)*255
        print(k,save(c,m,k)); continue
    c=im[y0:y1,x0:x1]
    if k=='towel':
        ms=cut(c,2); t=ms[0]|outline_fill(c,5); print(k,save(c,t,'towel'),'chopsticks',save(c,ms[1],'chopsticks'))
    else:
        print(k,save(c,cut(c)[0],k))
# 미리보기
import glob,os
fs=sorted(glob.glob(OUT+'prop_*.webp')); o=Image.new('RGBA',(7*190,3*200),(255,0,255,255))
for i,f in enumerate(fs):
    p=Image.open(f).convert('RGBA'); p.thumbnail((180,180)); o.alpha_composite(p,((i%7)*190+5,(i//7)*200+5))
o.convert('RGB').save('scratchpad/props_prev.png'); print(len(fs))
