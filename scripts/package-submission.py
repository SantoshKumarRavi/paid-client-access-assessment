"""Package only reviewable source/evidence; fail if local secrets leaked into it."""
from pathlib import Path
import zipfile,hashlib,json,datetime
ROOT=Path(__file__).resolve().parents[1]
out=ROOT/'output/Paid_Client_Access_Submission.zip'
excluded={'node_modules','dist','tmp','test-results','.git','output','__pycache__'}
files=[]
for path in ROOT.rglob('*'):
    if not path.is_file():continue
    relative=path.relative_to(ROOT)
    if any(part in excluded for part in relative.parts):continue
    if path.name.startswith('.env') and path.name!='.env.example':continue
    if path.suffix in {'.log','.pyc'}:continue
    files.append((path,relative.as_posix()))
pdf=ROOT/'output/pdf/Paid_Client_Access_Architecture_Testing_Interview_Guide.pdf'
if not pdf.exists():raise RuntimeError('Build and review the PDF before packaging')
files.append((pdf,'output/pdf/'+pdf.name))
private={}
for line in (ROOT/'.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1)
        if key in {'SUPABASE_SECRET_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','ZOHO_CLIENT_SECRET','ZOHO_REFRESH_TOKEN','ZOHO_ACCESS_TOKEN','CRON_SECRET','DEMO_PASSWORD'} and value:
            private[key]=value.strip().strip('"').strip("'").encode()
manifest=[]
for path,name in files:
    content=path.read_bytes()
    for key,value in private.items():
        if value in content:raise RuntimeError(f'Credential leak detected in {name}: {key}')
    manifest.append({'path':name,'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest()})
out.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for path,name in sorted(files,key=lambda pair:pair[1]):archive.write(path,name)
    archive.writestr('SUBMISSION_MANIFEST.json',json.dumps({'created_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':manifest,'secret_scan':'passed'},indent=2))
print(f'{out} | {len(files)} files | {out.stat().st_size} bytes | credential scan passed')
