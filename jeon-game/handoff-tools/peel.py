import numpy as np, glob, sys
from PIL import Image
from scipy import ndimage
def peel(path, mode, it=5):
    im=np.array(Image.open(path).convert('RGBA')).astype(np.int16)
    rgb=im[:,:,:3]; a=im[:,:,3]>40
    mx=rgb.max(2); mn=rgb.min(2); sat=mx-mn
    if mode=='gray': bgl=(sat<24)&(mx>95)&(mx<200)        # 시트의 회색 배경 + 그림자
    else: bgl=(mn>205)                                     # 흰 배경
    removed=0
    for _ in range(it):
        edge=a & ~ndimage.binary_erosion(a)
        kill=edge & bgl
        if not kill.any(): break
        a[kill]=False; removed+=int(kill.sum())
    # 남은 작은 회색 섬 정리
    lab,n=ndimage.label(a); 
    if n>1:
        sizes=ndimage.sum(a,lab,range(1,n+1)); keep=np.isin(lab, 1+np.where(sizes>=max(30,sizes.max()*0.002))[0]); a=a&keep
    out=im.copy().astype(np.uint8); out[:,:,3]=np.where(a,255,0)
    Image.fromarray(out).save(path, lossless=True, quality=100, method=6)
    return removed
for f in sorted(glob.glob('char_*.webp')+glob.glob('prop_*.webp')+glob.glob('dish_*.webp')):
    print(f, peel(f,'gray'))
for k in ['potato','kimchi','pepper','zucchini']:
    for f in (f'ing_{k}.webp', f'pc_{k}.webp'): print(f, peel(f,'white'))
