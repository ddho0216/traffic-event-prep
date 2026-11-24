# 소품·재료 PNG(투명 배경)의 외곽선을 따서 contours.json 으로 저장. mock3d_scene.html 이 이 파일로 두께 있는 3D 조각을 만든다.
# 사용: tex/ 폴더에 투명 PNG를 넣고 실행 → contours.json
import cv2, numpy as np, json, glob, os
out={}
for f in sorted(glob.glob('tex/*.png')):
    n=os.path.basename(f)[:-4]
    if n.startswith('top_') or n.startswith('dish_'): continue
    im=cv2.imread(f,cv2.IMREAD_UNCHANGED); a=(im[:,:,3]>60).astype(np.uint8)*255
    a=cv2.morphologyEx(a,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8))
    cs,_=cv2.findContours(a,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    c=max(cs,key=cv2.contourArea); eps=0.004*cv2.arcLength(c,True); c=cv2.approxPolyDP(c,eps,True)
    out[n]={'w':im.shape[1],'h':im.shape[0],'pts':c.reshape(-1,2).tolist()}
json.dump(out,open('contours.json','w'))
