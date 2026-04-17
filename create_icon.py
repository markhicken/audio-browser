from PIL import Image, ImageDraw
import math

# Create a 512x512 image with transparent background
img = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# ===== Color Definitions =====
speaker_fill_color = (255, 255, 255, 255)  # White
speaker_stroke_color = (240, 240, 240, 255)  # Light gray
cone_color = (60, 60, 60, 255)        # Dark gray
dome_color = (240, 240, 240, 255)  # Light gray

# ===== Cabinet =====
cabinet_stroke_color = speaker_stroke_color
cabinet_stroke_width = 3
cabinet_width = 300
cabinet_height = 475
cabinet_x = (512 - cabinet_width) // 2
cabinet_y = 18
cabinet_corner_radius = 30

# ===== Tweeter Dimensions =====
tweeter_radius = 64
tweeter_center = (256, 110)
tweeter_stroke_color = speaker_stroke_color
tweeter_stroke_width = 14
tweeter_dome_radius = 16
tweeter_dome_stroke_color = cone_color
tweeter_dome_stroke_width = 1

# ==== Woofer Dimensions =====
woofer_radius = 140
woofer_center = (256, 324)
woofer_stroke_color = speaker_stroke_color
woofer_stroke_width = 20
woofer_dome_radius = 30
woofer_dome_stroke_color = cone_color
woofer_dome_stroke_width = 2


# ===== Drawing =====
draw.rounded_rectangle([cabinet_x, cabinet_y, cabinet_x + cabinet_width, cabinet_y + cabinet_height], 
                       radius=cabinet_corner_radius, fill=speaker_fill_color, outline=cabinet_stroke_color, width=cabinet_stroke_width)

# Small tweeter (upper)
draw.ellipse((tweeter_center[0] - tweeter_radius, tweeter_center[1] - tweeter_radius,
              tweeter_center[0] + tweeter_radius, tweeter_center[1] + tweeter_radius),
             fill=cone_color, outline=tweeter_stroke_color, width=tweeter_stroke_width)

# Tweeter center dome
draw.ellipse((tweeter_center[0] - tweeter_dome_radius, tweeter_center[1] - tweeter_dome_radius,
              tweeter_center[0] + tweeter_dome_radius, tweeter_center[1] + tweeter_dome_radius),
             fill=dome_color, outline=tweeter_dome_stroke_color, width=tweeter_dome_stroke_width)

# Large woofer (speaker cone)
draw.ellipse((woofer_center[0] - woofer_radius, woofer_center[1] - woofer_radius,
              woofer_center[0] + woofer_radius, woofer_center[1] + woofer_radius),
             fill=cone_color, outline=woofer_stroke_color, width=woofer_stroke_width)

# Woofer center dome
draw.ellipse((woofer_center[0] - woofer_dome_radius, woofer_center[1] - woofer_dome_radius,
              woofer_center[0] + woofer_dome_radius, woofer_center[1] + woofer_dome_radius),
             fill=dome_color, outline=woofer_dome_stroke_color, width=woofer_dome_stroke_width)

# Save the image
img.save('assets/icon.png')

# Convert to ICO
img_ico = Image.open('assets/icon.png')
img_ico.save('assets/icon.ico', format='ICO', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])

# Convert to ICNS for Mac
img.save('assets/icon.icns', format='ICNS')

print("Icon created successfully!")
