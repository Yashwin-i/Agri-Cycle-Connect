import cv2
import albumentations as A
import os
import pandas as pd
from tqdm import tqdm

# Load the labels we just created
df = pd.read_csv("stubble_labels.csv")
OUTPUT_FOLDER = "augmented_rice"
if not os.path.exists(OUTPUT_FOLDER): os.makedirs(OUTPUT_FOLDER)

# The Pipeline (Optimized for Punjab/Haryana stubble)
transform = A.Compose([
    A.HorizontalFlip(p=0.5),
    A.RandomRotate90(p=0.5),
    A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.8),
    A.HueSaturationValue(hue_shift_limit=10, sat_shift_limit=20, p=0.5),
    A.GaussNoise(var_limit=(10.0, 50.0), p=0.3), # For network-degraded quality
])

new_dataset = []

for _, row in tqdm(df.iterrows(), total=len(df)):
    img_path = os.path.join("raw_rice", row['filename'])
    image = cv2.imread(img_path)
    if image is None: continue
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    for i in range(14):
        aug_name = f"aug_{i}_{row['filename']}"
        augmented = transform(image=image)["image"]
        cv2.imwrite(os.path.join(OUTPUT_FOLDER, aug_name), cv2.cvtColor(augmented, cv2.COLOR_RGB2BGR))
        
        # Link the new image to the same density value
        new_dataset.append({"filename": aug_name, "stubble_density": row['stubble_density']})

# Save the final big dataset labels
pd.DataFrame(new_dataset).to_csv("final_augmented_labels.csv", index=False)
print("Success! 2,800 images generated. Use 'final_augmented_labels.csv' to train your model.")