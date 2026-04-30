import cv2
import numpy as np
import os
import pandas as pd
from tqdm import tqdm

INPUT_FOLDER = "raw_rice"
output_data = []

for img_name in tqdm(os.listdir(INPUT_FOLDER)):
    if img_name.lower().endswith(('.png', '.jpg', '.jpeg')):
        img = cv2.imread(os.path.join(INPUT_FOLDER, img_name))
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        
        # Range for brownish/yellow stubble
        lower_stubble = np.array([10, 20, 20]) 
        upper_stubble = np.array([30, 255, 255])
        
        mask = cv2.inRange(hsv, lower_stubble, upper_stubble)
        density = (np.sum(mask > 0) / mask.size) * 100 # Percentage coverage
        
        output_data.append({"filename": img_name, "stubble_density": round(density, 2)})

# Save your new Ground Truth
pd.DataFrame(output_data).to_csv("stubble_labels.csv", index=False)
print("Done! 'stubble_labels.csv' created with 200 entries.")