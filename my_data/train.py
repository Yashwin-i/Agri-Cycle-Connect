import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Dataset, DataLoader
from torchvision import models, transforms
from PIL import Image
import pandas as pd
import os
from tqdm import tqdm

# --- 1. Custom Dataset Class ---
class StubbleDataset(Dataset):
    def __init__(self, csv_file, img_dir, transform=None):
        self.data = pd.read_csv(csv_file)
        self.img_dir = img_dir
        self.transform = transform

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        img_name = os.path.join(self.img_dir, self.data.iloc[idx, 0])
        image = Image.open(img_name).convert("RGB")
        
        # The 'label' is your stubble density or biomass weight
        label = torch.tensor(float(self.data.iloc[idx, 1]), dtype=torch.float32)
        
        if self.transform:
            image = self.transform(image)
            
        return image, label

# --- 2. Training Setup ---
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
EPOCHS = 20
BATCH_SIZE = 32
LEARNING_RATE = 0.001

# Image transformations for ResNet (Standard ImageNet normalization)
data_transforms = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
])

# Load Dataset
dataset = StubbleDataset(csv_file='final_augmented_labels.csv', 
                         img_dir='augmented_rice', 
                         transform=data_transforms)
train_loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)

# --- 3. Modify ResNet-50 for Regression ---
model = models.resnet50(weights=models.ResNet50_Weights.DEFAULT)

# Change the fully connected (fc) layer: 
# Input: 2048 features, Output: 1 single value (Biomass/Density)
model.fc = nn.Linear(model.fc.in_features, 1)
model = model.to(device)

# Loss and Optimizer
criterion = nn.MSELoss() # Mean Squared Error is best for regression
optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)

# --- 4. Training Loop ---
print(f"Starting training on {device}...")
model.train()

for epoch in range(EPOCHS):
    running_loss = 0.0
    loop = tqdm(train_loader, total=len(train_loader), leave=True)
    
    for images, labels in loop:
        images, labels = images.to(device), labels.to(device).view(-1, 1)
        
        # Forward pass
        outputs = model(images)
        loss = criterion(outputs, labels)
        
        # Backward pass and optimize
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        
        running_loss += loss.item()
        loop.set_description(f"Epoch [{epoch+1}/{EPOCHS}]")
        loop.set_postfix(loss=loss.item())

# --- 5. Save the Model ---
torch.save(model.state_dict(), "stubble_resnet50.pth")
print("Training Complete. Model saved as 'stubble_resnet50.pth'")