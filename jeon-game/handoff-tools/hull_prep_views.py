import cv2, numpy as np, json
from PIL import Image
OUT='scratchpad/c3d/views/'
SHEETS={'6':'images/6.jpg','7':'images/7.jpg','8':'images/8.jpg'}
# 패널 (x0,y0,x1,y1)
P={
 'me':     ('6',{'front':(0,55,310,392),'back':(320,55,640,392),'right':(680,55,870,392),'left':(890,55,1080,392),'top':(1090,60,1376,300)}),
 'sister': ('6',{'front':(0,432,310,768),'back':(320,432,640,768),'right':(680,432,870,768),'left':(890,432,1080,768),'top':(1090,440,1376,700)}),
 'grandma':('7',{'front':(30,125,345,735),'back':(345,125,650,735),'right':(655,125,870,735),'left':(875,125,1085,735),'top':(1080,125,1376,520)}),
 'mom':    ('8',{'front':(60,28,355,368),'back':(360,28,640,368),'right':(680,28,860,368),'left':(880,28,1060,368),'top':(1040,100,1376,300)}),
 'dad':    ('8',{'front':(60,405,355,750),'back':(360,405,640,750),'right':(680,405,860,750),'left':(880,405,1060,750),'top':(1040,480,1376,650)}),
}
meta={}
for ch,(sh,views) in P.items():
    im=cv2.imread(SHEETS[sh]); meta[ch]={}
    bg=np.median(np.concatenate([im[:6].reshape(-1,3),im[-6:].reshape(-1,3)]),axis=0)
    for v,(x0,y0,x1,y1) in views.items():
        c=im[y0:y1,x0:x1].astype(np.int16)
        d=np.abs(c-bg).sum(2)
        m=((d>40)|(c.max(2)<60)).astype(np.uint8)*255
        # 외곽선 안쪽 채우기 (배경과 색이 비슷한 옷 대비)
        ol=(c.max(2)<85).astype(np.uint8)*255
        ol=cv2.dilate(ol,np.ones((3,3),np.uint8))
        free=(255-ol).copy(); hh,ww=free.shape; mk2=np.zeros((hh+2,ww+2),np.uint8)
        for sx,sy in [(0,0),(ww-1,0),(0,hh-1),(ww-1,hh-1)]:
            if free[sy,sx]==255: cv2.floodFill(free,mk2,(sx,sy),128)
        inside=((free!=128)).astype(np.uint8)*255
        m=m|inside
        m=cv2.morphologyEx(m,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,5)))
        m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
        n,lab,st,_=cv2.connectedComponentsWithStats(m)
        i=1+np.argmax(st[1:,cv2.CC_STAT_AREA]); m=(lab==i).astype(np.uint8)*255
        ff=m.copy(); h,w=m.shape; mk=np.zeros((h+2,w+2),np.uint8); cv2.floodFill(ff,mk,(0,0),255); m=m|(255-ff)
        ys,xs=np.where(m>0); bx0,bx1,by0,by1=xs.min(),xs.max()+1,ys.min(),ys.max()+1
        crop=c[by0:by1,bx0:bx1].astype(np.uint8); a=m[by0:by1,bx0:bx1]
        rgba=np.dstack([crop[:,:,::-1],a])
        Image.fromarray(rgba).save(OUT+f'{ch}_{v}.png')
        H,W=a.shape
        # 가슴 높이(위에서 35%)의 몸 중심
        row=a[int(H*0.35)]; xs2=np.where(row>0)[0]
        cx=float((xs2.min()+xs2.max())/2) if len(xs2) else W/2
        meta[ch][v]={'w':int(W),'h':int(H),'cx':cx}
        print(ch,v,W,H,round(cx,1))
json.dump(meta,open('scratchpad/c3d/views/meta.json','w'))
# 확인용 미리보기
for ch in P:
    ims=[Image.open(OUT+f'{ch}_{v}.png') for v in ['front','back','right','left','top']]
    Hh=max(i.height for i in ims); o=Image.new('RGBA',(sum(i.width for i in ims)+40,Hh),(255,0,255,255)); x=0
    for i in ims: o.alpha_composite(i,(x,0)); x+=i.width+10
    o.convert('RGB').save(f'scratchpad/c3d/prev_{ch}.png')
