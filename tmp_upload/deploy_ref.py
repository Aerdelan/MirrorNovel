import base64, sys

# Read the base64 file
with open('/root/deploy_ref_b64.txt') as f:
    data = base64.b64decode(f.read().strip())

# Write to the target
with open('/root/fanqiexiaoshuo_20260527210719/server/routes/reference.js', 'wb') as f:
    f.write(data)

print('Written', len(data), 'bytes')
