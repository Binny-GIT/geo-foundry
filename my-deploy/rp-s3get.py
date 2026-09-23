#!/usr/bin/env python3
"""S3 Object 操作（SigV4，纯标准库）：
argv = access_key_file secret_key_file bucket key [endpoint_host] [port] [--delete]
默认 GET：对象字节写 stdout；--delete：删除对象（幂等）。
供 e2e-real-publish.sh 在没有 aws CLI 的宿主机上直读/清理 rustfs。"""
import datetime
import hashlib
import hmac
import sys
import urllib.parse
import urllib.request


def main() -> int:
    args = list(sys.argv[1:])
    delete = False
    if "--delete" in args:
        delete = True
        args.remove("--delete")
    if len(args) < 4:
        print("usage: rp-s3get.py AK_FILE SK_FILE BUCKET KEY [HOST] [PORT] [--delete]", file=sys.stderr)
        return 2
    ak_file, sk_file, bucket, key = args[0], args[1], args[2], args[3]
    host = args[4] if len(args) > 4 else "127.0.0.1"
    port = args[5] if len(args) > 5 else "9000"
    with open(ak_file, encoding="utf-8") as f:
        ak = f.read().strip()
    with open(sk_file, encoding="utf-8") as f:
        sk = f.read().strip()
    verb = "DELETE" if delete else "GET"
    region, service = "us-east-1", "s3"
    amzdate = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    datestamp = amzdate[:8]
    payload_hash = hashlib.sha256(b"").hexdigest()
    encoded_key = urllib.parse.quote(key, safe="/")
    canonical_uri = "/{}/{}".format(bucket, encoded_key)
    canonical_headers = "host:{}:{}\nx-amz-content-sha256:{}\nx-amz-date:{}\n".format(
        host, port, payload_hash, amzdate
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "{}\n{}\n\n{}\n{}\n{}".format(
        verb, canonical_uri, canonical_headers, signed_headers, payload_hash
    )
    scope = "{}/{}/{}/aws4_request".format(datestamp, region, service)
    string_to_sign = "AWS4-HMAC-SHA256\n{}\n{}\n{}".format(
        amzdate, scope, hashlib.sha256(canonical_request.encode()).hexdigest()
    )

    def hmac_sha256(msg: bytes, key: bytes) -> bytes:
        return hmac.new(key, msg, hashlib.sha256).digest()

    k_date = hmac_sha256(datestamp.encode(), b"AWS4" + sk.encode())
    k_region = hmac_sha256(region.encode(), k_date)
    k_service = hmac_sha256(service.encode(), k_region)
    k_signing = hmac_sha256(b"aws4_request", k_service)
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}".format(
            ak, scope, signed_headers, signature
        )
    )
    request = urllib.request.Request(
        "http://{}:{}/{}/{}".format(host, port, bucket, encoded_key),
        headers={
            "Authorization": authorization,
            "x-amz-date": amzdate,
            "x-amz-content-sha256": payload_hash,
        },
        method=verb,
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        sys.stdout.buffer.write(response.read())
    return 0


if __name__ == "__main__":
    sys.exit(main())
