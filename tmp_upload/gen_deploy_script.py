import base64

# Read the reference.js and encode to base64
b64 = base64.b64encode(open('d:/fanqiexiaoshuo/server/routes/reference.js', 'rb').read()).decode()
chunk_size = 1800
chunks = [b64[i:i+chunk_size] for i in range(0, len(b64), chunk_size)]

print(f'{len(chunks)} chunks needed')

# Generate deployment script
lines = ['#!/bin/bash']
lines.append(f'# Auto-deploy reference.js ({len(chunks)} chunks)')
lines.append('rm -f /root/deploy_ref_b64.txt')
lines.append('touch /root/deploy_ref_b64.txt')
for chunk in chunks:
    lines.append(f'echo "{chunk}" >> /root/deploy_ref_b64.txt')
lines.append('python3 /root/deploy_ref_helper.py')
lines.append('rm -f /root/deploy_ref_b64.txt')
lines.append('rm -f /root/deploy_ref_helper.py')
lines.append('echo "Deploy complete"')

script = '\n'.join(lines)
with open('d:/fanqiexiaoshuo/tmp_upload/deploy_ref_batch.sh', 'w', encoding='utf-8') as f:
    f.write(script)

print(f'Script written: {len(script)} chars, {len(lines)} lines')
