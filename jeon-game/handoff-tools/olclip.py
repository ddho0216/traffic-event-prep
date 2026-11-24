import numpy as np, cv2, sys
from PIL import Image
def clip(path, dark=80, grow=2):
    im=np.array(Image.open(path).convert('RGBA')); a=im[:,:,3]>40
    h,w=a.shape
    ol=((im[:,:,:3].max(2)<dark)&a).astype(np.uint8)*255
    ol=cv2.dilate(ol,np.ones((3,3),np.uint8))
    pad=np.pad(255-ol,2,constant_values=255); mk=np.zeros((h+6,w+6),np.uint8)
    cv2.floodFill(pad,mk,(0,0),128); inside=(pad[2:-2,2:-2]!=128)
    inside=cv2.dilate(inside.astype(np.uint8),np.ones((grow*2+1,grow*2+1),np.uint8))>0
    new=a&inside
    n,lab,st,_=cv2.connectedComponentsWithStats(new.astype(np.uint8))
    if n>1:
        keep=1+np.where(st[1:,cv2.CC_STAT_AREA]>=max(30,st[1:,cv2.CC_STAT_AREA].max()*0.01))[0]; new=np.isin(lab,keep)
    if new.sum()<a.sum()*0.6: return 'skip(%.2f)'%(new.sum()/a.sum())
    im[:,:,3]=np.where(new,255,0); Image.fromarray(im).save(path,lossless=True,method=6)
    return '%.3f'%(1-new.sum()/a.sum())
for f in sys.argv[1:]: print(f,clip(f))
