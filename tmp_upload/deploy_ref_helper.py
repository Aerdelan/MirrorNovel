import base64, sys

target = "/root/fanqiexiaoshuo_20260527210719/server/routes/reference.js"
b64_path = "/root/deploy_ref_b64.txt"

with open(b64_path) as f:
    data = base64.b64decode(f.read().strip())

with open(target, 'wb') as f:
    f.write(data)

print("Written", len(data), "bytes to", target)
