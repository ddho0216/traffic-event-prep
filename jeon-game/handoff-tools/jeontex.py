import numpy as np
from PIL import Image, ImageFilter
OUT='/home/user/traffic-event-prep/jeon-game/assets/'
im3=Image.open('images/3.jpg').convert('RGB'); im4=Image.open('images/4.jpg').convert('RGB')
S=256
yy,xx=np.mgrid[0:S,0:S]; rr=np.hypot(xx-(S-1)/2,yy-(S-1)/2)/((S-1)/2)
def unwarp(im,cx,cy,rx,ry,shrink=0.96):
    c=im.crop((cx-rx,cy-ry,cx+rx,cy+ry)).resize((S,S),Image.LANCZOS)
    a=np.array(c).astype(np.float32)
    return a
def save(a,name,mask=True):
    a=np.clip(a,0,255).astype(np.uint8)
    alpha=np.where(rr<=0.97,255,0).astype(np.uint8) if mask else np.full((S,S),255,np.uint8)
    Image.fromarray(np.dstack([a,alpha])).save(OUT+name,quality=88,method=6)
def lerp(a,c,t): return a*(1-t)+np.array(c,np.float32)*t
rng=np.random.default_rng(3)
def burnt(a):
    n=np.array(Image.fromarray(rng.integers(0,255,(32,32)).astype(np.uint8)).resize((S,S),Image.BICUBIC)).astype(np.float32)/255
    n=np.array(Image.fromarray((n*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32)/255
    m=np.clip((n-0.45)/0.12,0,1)[...,None]*0.85
    edge=np.clip((rr-0.6)/0.4,0,1)[...,None]*0.6
    m=np.clip(m+edge,0,0.92)
    d=a*np.array([0.45,0.36,0.3],np.float32)
    return d*(1-m)+np.array([26,24,22],np.float32)*m
def stages(fin):
    t1=lerp(fin,[236,214,200],0.72)
    edge=np.clip((rr-0.72)/0.2,0,1)[...,None]
    t2=lerp(fin,[234,212,196],0.6)*(1-edge)+lerp(fin,[214,128,58],0.45)*edge
    t3=lerp(fin,[226,160,80],0.38)
    return [t1,t2,t3,fin,burnt(fin)]
DISH={'haemul':(690,212,180,118),'buchu':(1152,205,150,104),'gamja':(230,585,178,108)}
for k,(cx,cy,rx,ry) in DISH.items():
    fin=unwarp(im3,cx,cy,rx,ry)
    for i,t in enumerate(stages(fin)): save(t,f'st_{k}_{i+1}.webp')
    save(fin,f'top_{k}.webp')
# 김치전: 단계 1~4는 이미지 4 그대로, 5는 태움
P=[(112,152,74,42),(390,152,76,42),(665,150,75,42),(940,150,77,44)]
for i,(cx,cy,rx,ry) in enumerate(P): save(unwarp(im4,cx,cy,rx,ry),f'st_kimchi_{i+1}.webp')
before=unwarp(im4,392,560,158,108)
save(before,'top_kimchi.webp'); save(burnt(before),'st_kimchi_5.webp')
# 호박전: 슬라이스 하나
sl=im3.crop((718,503,798,557)).resize((128,128),Image.LANCZOS); a=np.array(sl)
y2,x2=np.mgrid[0:128,0:128]; r2=np.hypot(x2-63.5,y2-63.5)/63.5
Image.fromarray(np.dstack([a,np.where(r2<=0.96,255,0).astype(np.uint8)])).save(OUT+'top_hobak.webp',quality=88)
# 도감용 완성 접시 그림
for k,box in {'kimchi':(30,80,430,350),'haemul':(495,80,890,350),'buchu':(955,80,1350,345),'gamja':(30,460,430,725),'hobak':(485,455,890,725)}.items():
    im3.crop(box).save(OUT+f'dish_{k}.webp',quality=85)
# 확인용
prev=Image.new('RGB',(5*130,4*130),(120,120,120))
for r,k in enumerate(['kimchi','haemul','buchu','gamja']):
    for i in range(5):
        t=Image.open(OUT+f'st_{k}_{i+1}.webp').convert('RGBA').resize((128,128)); prev.paste(t,(i*130,r*130),t)
prev.save('scratchpad/stages_prev.png')
