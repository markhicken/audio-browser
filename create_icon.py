from PIL import Image, ImageDraw
import math

# Create a 512x512 image with transparent background
img = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Speaker colors
speaker_color = (255, 255, 255, 255)  # White
cone_color = (70, 70, 70, 255)        # Dark gray
highlight_color = (200, 200, 200, 255) # Light gray

# Speaker cabinet (main body)
cabinet_width = 300
cabinet_height = 475
cabinet_x = (512 - cabinet_width) // 2
cabinet_y = 18
draw.rounded_rectangle([cabinet_x, cabinet_y, cabinet_x + cabinet_width, cabinet_y + cabinet_height], 
                       radius=30, fill=speaker_color, outline=speaker_color, width=3)

# Large woofer (speaker cone)
woofer_radius = 140
woofer_center = (256, 320)
draw.ellipse((woofer_center[0] - woofer_radius, woofer_center[1] - woofer_radius,
              woofer_center[0] + woofer_radius, woofer_center[1] + woofer_radius),
             fill=cone_color, outline=speaker_color, width=4)

# Woofer center dome
dome_radius = 32
draw.ellipse((woofer_center[0] - dome_radius, woofer_center[1] - dome_radius,
              woofer_center[0] + dome_radius, woofer_center[1] + dome_radius),
             fill=highlight_color, outline=cone_color, width=2)

# Small tweeter (upper)
tweeter_radius = 50
tweeter_center = (256, 110)
draw.ellipse((tweeter_center[0] - tweeter_radius, tweeter_center[1] - tweeter_radius,
              tweeter_center[0] + tweeter_radius, tweeter_center[1] + tweeter_radius),
             fill=cone_color, outline=speaker_color, width=3)

# Tweeter center dome
dome_radius_small = 16
draw.ellipse((tweeter_center[0] - dome_radius_small, tweeter_center[1] - dome_radius_small,
              tweeter_center[0] + dome_radius_small, tweeter_center[1] + dome_radius_small),
             fill=highlight_color, outline=cone_color, width=1)

# Save the image
img.save('assets/icon.png')

# Convert to ICO
img_ico = Image.open('assets/icon.png')
img_ico.save('assets/icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])

print("Icon created successfully!")
