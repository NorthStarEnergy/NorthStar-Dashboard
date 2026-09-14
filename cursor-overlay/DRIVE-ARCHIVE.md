# Recreate a source tarball from Origin (Drive binary upload is size-limited)

Private Origin repo: https://cursor.com/codebase/force-of-nature-genetics/outage-stitch
HEAD: `08fefe14361831bd8fe977c731e1caa6ca19e769`

```bash
origin auth login
origin repo clone force-of-nature-genetics/outage-stitch
cd outage-stitch
git archive --format=tar.gz --prefix=outage-stitch/ -o outage-stitch-src.tgz HEAD -- ':!package-lock.json'
sha256sum outage-stitch-src.tgz
```

Expected SHA-256 for this HEAD (source only, no lockfile):

`0a7ea55787a2aedcc26268eea8f57fe6a0c1bf3a2e3cc128846967eba71c98d6`

Full archive including `package-lock.json`:

`eea3022bd62fe4fc19dcda918a11bd50bf3587bcff697c1b0e5527d801fa33ae`

Copy the `.tgz` into:

- https://drive.google.com/drive/folders/1AgBNR9cqU5vENV5SiX4T8BUKwIxwcguV
- https://drive.google.com/drive/folders/1zmtlWIypzy_yqzmNi02Zmh4bHMIU8Qv3

Index already on Drive: https://drive.google.com/file/d/1MBt0IkRp4Nmk4GfF_zw_0p-FGTccTZeL/view?usp=drivesdk
