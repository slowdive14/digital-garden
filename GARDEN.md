# 가든 운영 방법

Obsidian Digital Garden 플러그인 없이, 폴더 동기화 스크립트와 Quartz로 사이트를 만듭니다.

## 구조

```
D:\digital-garden
├─ garden.sync.json       어떤 폴더의 노트를 가져올지 정하는 설정
├─ garden.local.json      열어 보지 않을 폴더 목록 (git에 올라가지 않음)
├─ scripts/sync-garden.mjs    노트 복사 + 개인정보 검사
├─ scripts/publish-garden.mjs 복사 → 검사 → 커밋 → 푸시
├─ site/                  직접 쓰는 페이지(첫 화면, 폴더 소개)
├─ import/hugo-posts/     예전 Hugo 블로그 글 10편
├─ content/               스크립트가 만드는 폴더 (직접 고치지 않음)
├─ quartz.config.yaml     사이트 설정(제목, 색, 글꼴, 플러그인)
├─ quartz/styles/custom.scss  디자인 세부 조정
└─ DESIGN.md              디자인 규칙
```

## 노트를 공개하는 법

1. 메인 볼트(`Learning Journey`)의 노트 머리말 맨 바깥에 `publish: true`를 적습니다. 예전 플러그인 표시인 `dg-publish: true`도 인식합니다. `tistory:` 아래처럼 들여쓴 `publish: true`는 다른 플러그인 설정이라 무시합니다.
2. 아래 명령 하나로 복사, 개인정보 검사, 커밋, 푸시까지 합니다. 푸시하면 GitHub Actions가 사이트를 다시 배포합니다.

   ```
   npm run garden:publish
   ```

   볼트 전체를 살펴보느라 처음에는 40초 정도, 그다음부터는 10초 정도 걸립니다.

3. 배포 전에 미리 보고 싶으면 복사만 한 뒤 미리보기를 켭니다.

   ```
   npm run garden:sync
   ```

   ```
   npx quartz build --serve
   ```

   http://localhost:8080 에서 볼 수 있습니다.

### 어디서 가져오나

`garden.sync.json`의 `sources`에 적힌 순서대로 가져옵니다. 같은 파일명이 겹치면 앞쪽 원본을 씁니다.

1. `site/`: 첫 화면과 폴더 소개처럼 직접 쓰는 페이지
2. 메인 볼트: `publish: true`인 노트
3. 옛 가든 폴더(`D:/slowdive/notes`): 메인 볼트에 아직 표시하지 않은 예전 공개 노트
4. `import/hugo-posts/`: 예전 Hugo 글

메인 볼트에서 같은 노트에 표시를 붙이면 그 노트가 옛 가든 사본을 대신합니다. 노트에 첨부한 이미지·PDF도 함께 복사합니다.

### 아예 열어 보지 않는 폴더

`garden.local.json`의 `blockedPathSegments`에 적힌 이름의 폴더는 `publish: true`가 있어도 읽지 않습니다. 상담 기록, 일간·주간 노트, 금융, 가족 기록 같은 폴더가 들어 있습니다. 이 파일은 폴더 이름이 드러나지 않도록 git에 올라가지 않습니다.

## 개인정보 검사

`garden:sync`는 복사가 끝나면 휴대전화 번호, 주민등록번호, 이메일 주소처럼 보이는 내용을 찾아 알려 주고, 발견되면 실패로 끝납니다. GitHub에서 배포할 때도 같은 검사를 한 번 더 합니다.

- 공개되면 안 되는 단어(내담자 이름, 기관 내부 명칭 등)는 `.garden-denylist.example.txt`를 `.garden-denylist.txt`로 복사해서 적어 둡니다. 이 파일은 git에 올라가지 않습니다.
- 일부러 공개한 내용이라면 `garden.local.json`의 `allowSensitive`에 파일 경로를 추가합니다.

## 변환해 주는 것

- Admonition 플러그인의 ` ```ad-quote ` 블록 → Obsidian 콜아웃
- `obsidian://open?...` 링크 → 위키링크(공개되지 않은 노트면 평범한 글자로 표시)
- 본문 위쪽의 `Created: 2023-10-03` 줄 → 작성일
- 제목과 같은 첫 제목줄 → 삭제(사이트가 제목을 따로 보여 줌)
- 폴더 이름 앞의 번호(`1.2. `) → 탐색기에서는 빼고 표시

## Windows에서 알아 둘 점

- D 드라이브가 파일 소유자를 기록하지 않는 형식이라 git이 저장소를 거부합니다. 한 번만 아래 명령을 실행해 두면 됩니다.

  ```
  git config --global --add safe.directory D:/digital-garden
  ```

- `npx quartz build --serve`가 켜진 상태에서 `custom.scss`나 설정을 바꾸면, 재빌드 중에 `public` 폴더를 지우지 못해 서버가 꺼질 수 있습니다. 그때는 서버를 다시 켜면 됩니다. GitHub Actions(Linux)에서는 생기지 않는 문제입니다.
- Node 24의 `fs.rmSync`는 한글 파일명을 지울 때 오류 메시지 없이 프로세스를 끝내 버립니다. 스크립트를 고칠 때는 `fs.promises.rm`을 쓰세요.

## 배포 (아직 하지 않음)

`.github/workflows/deploy.yml`이 준비되어 있습니다. GitHub에 새 저장소를 만들어 `main` 브랜치로 연결하고, 저장소 Settings → Pages → Source를 "GitHub Actions"로 바꾸면 `npm run garden:publish`로 배포됩니다. 저장소 이름이 정해지면 `quartz.config.yaml`의 `baseUrl`도 맞춰 바꿉니다.

저장소가 연결되기 전에는 `garden:publish`가 복사와 검사까지만 하고 멈춥니다. Quartz 원본 저장소(`jackyzha0/quartz`)로는 절대 푸시하지 않도록 막혀 있습니다.

개인 도메인을 쓰지 않는 동안은 `quartz.config.yaml`의 `cname` 플러그인을 꺼 두어야 합니다. 켜 두면 `slowdive14.github.io`를 개인 도메인으로 선언하는 파일이 생겨 사이트 주소가 꼬입니다.
