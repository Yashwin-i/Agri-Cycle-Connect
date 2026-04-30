import cv2
import albumentations as A
import os
from tqdm import tqdm
import numpy as np

# --- CONFIGURATION ---
INPUT_FOLDER = "raw_rice"
OUTPUT_FOLDER = "augmented_rice"
NUM_AUG_PER_IMAGE = 14  # To get from 200 to ~2,800

# Create output folder if it doesn't exist
if not os.path.exists(OUTPUT_FOLDER):
    os.makedirs(OUTPUT_FOLDER)

# --- THE AUGMENTATION PIPELINE ---
# Tailored for Rice Field Biomass (Punjab/Haryana context)
transform = A.Compose([
    # 1. Spatial/Geometry (Field shots vary by angle)
    A.HorizontalFlip(p=0.5),
    A.VerticalFlip(p=0.2),
    A.RandomRotate90(p=0.5),
    A.ShiftScaleRotate(shift_limit=0.05, scale_limit=0.1, rotate_limit=15, p=0.5),
    
    # 2. Lighting (Mimicking Morning, Afternoon, Overcast)
    A.RandomBrightnessContrast(brightness_limit=0.3, contrast_limit=0.3, p=0.8),
    A.HueSaturationValue(hue_shift_limit=15, sat_shift_limit=20, val_shift_limit=15, p=0.5),
    
    # 3. Environmental Conditions (Shadows/Fog)
    A.RandomShadow(num_shadows_limit=(1, 2), shadow_dimension=5, p=0.3),
    A.RandomFog(fog_coef_lower=0.1, fog_coef_upper=0.2, p=0.2),
    
    # 4. Quality (Mimicking network-compressed uploads)
    A.OneOf([
        A.MotionBlur(p=0.2),
        A.GaussNoise(var_limit=(10.0, 50.0), p=0.2),
        A.ImageCompression(quality_lower=60, quality_upper=100, p=0.3),
    ], p=0.4),
])

# --- PROCESSING ---
image_files = [f for f in os.listdir(INPUT_FOLDER) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]

print(f"Found {len(image_files)} images. Generating {len(image_files) * NUM_AUG_PER_IMAGE} augmented files...")

for img_name in tqdm(image_files):
    # Load image
    image_path = os.path.join(INPUT_FOLDER, img_name)
    image = cv2.imread(image_path)
    if image is None: continue
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB) # Convert to RGB for Albumentations

    # Save the original first (optional)
    # cv2.imwrite(os.path.join(OUTPUT_FOLDER, f"orig_{img_name}"), cv2.cvtColor(image, cv2.COLOR_RGB2BGR))

    # Generate augmented versions
    for i in range(NUM_AUG_PER_IMAGE):
        augmented = transform(image=image)["image"]
        
        # Save augmented image
        save_name = f"aug_{i}_{img_name}"
        save_path = os.path.join(OUTPUT_FOLDER, save_name)
        
        # Convert back to BGR for OpenCV saving
        cv2.imwrite(save_path, cv2.cvtColor(augmented, cv2.COLOR_RGB2BGR))

print(f"Success! Check the '{OUTPUT_FOLDER}' directory.")