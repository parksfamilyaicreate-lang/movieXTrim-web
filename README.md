# movieXTrim WEB (Python 不要 / Python-free)

이 폴더는 **Python 서버 없이 브라우저에서만 동작**하는 movieXTrim 웹 버전입니다.
GitHub Pages로 배포하면 별도 설치 없이 사용할 수 있습니다.

## 특징

- 영상을 로컬에서 선택하면 브라우저 메모리에 올리고, ffmpeg.wasm(WebAssembly)으로 직접 잘라냅니다.
- 장면 전환 감지는 JavaScript로 프레임을 샘플링해 수행합니다 (서버 전송 없음).
- 자동 분할 / 구간 잘라내기 / 구간만 남기기 / 구간별 파일 저장 / 다운로드 / 미리보기 지원.
- 한국어·영어·일본어 전환 가능(기본 일본어), 사용설명서 포함.

## 제한

- 음성 인식(Whisper)과 AI 편집 기능은 포함되지 않습니다 → 전체 기능은 `movieXTrim.exe` 사용.
- 영상은 브라우저 메모리에서 처리되므로 짧은 영상(약 50MB 이하)에 적합합니다.
- ffmpeg 코어(약 31MB)를 첫 실행 시 CDN에서 내려받습니다 → 첫 실행에 인터넷 연결 필요.
- 처리한 영상은 서버에 업로드되지 않고 브라우저 안에만 존재합니다.

## 온라인으로 올리는 방법

- 리포지토리를 **public**으로 바꾸면 Settings → Pages → Source: `main` / `/docs` 로 GitHub Pages 활성화 가능.
- 또는 Releases의 `movieXTrim-web.zip`을 https://app.netlify.com/drop 에 드래그하면 계정 없이 바로 URL이 발급됩니다.

## 로컬 미리보기

```powershell
python -m http.server 8000 --directory docs
```

브라우저에서 http://localhost:8000 접속 (미리보기용 서버일 뿐, 실제 처리에는 Python이 필요하지 않습니다).
