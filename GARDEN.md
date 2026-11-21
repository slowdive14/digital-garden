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
3. `import/old-garden/`: 예전 디지털 가든의 공개 노트. 원래 `D:/slowdive/notes`(USB)에서 가져왔는데 그 폴더를 지운 뒤 git 기록에서 이 저장소 안으로 옮겨 두었습니다.
4. `import/hugo-posts/`: 예전 Hugo 글

메인 볼트에서 같은 노트에 표시를 붙이면 그 노트가 옛 가든 사본을 대신합니다. 노트에 첨부한 이미지·PDF도 함께 복사합니다.

### 아예 열어 보지 않는 폴더

`garden.local.json`의 `blockedPathSegments`에 적힌 이름의 폴더는 `publish: true`가 있어도 읽지 않습니다. 상담 기록, 일간·주간 노트, 금융, 가족 기록 같은 폴더가 들어 있습니다. 이 파일은 폴더 이름이 드러나지 않도록 git에 올라가지 않습니다.

## 노트가 한꺼번에 사라지지 않게 하는 장치

- `garden.sync.json`의 원본 폴더 중 하나라도 없으면(USB를 빼 두었거나 폴더를 지운 경우) 동기화가 아무것도 지우지 않고 멈춥니다. 밤 11시 자동 배포도 이때는 올리지 않습니다. 정말 그 원본을 빼려면 `garden.sync.json`에서 지우거나 `"optional": true`를 붙입니다.
- 동기화 결과 노트 수가 직전보다 20% 넘게 줄면 실패로 끝나서 커밋·푸시하지 않습니다. 의도한 정리라면 `GARDEN_ALLOW_SHRINK=1`을 붙여 다시 실행합니다.

## 개인정보 검사

`garden:sync`는 복사가 끝나면 휴대전화 번호, 주민등록번호, 이메일 주소처럼 보이는 내용을 찾아 알려 주고, 발견되면 실패로 끝납니다. GitHub에서 배포할 때도 같은 검사를 한 번 더 합니다.

- 공개되면 안 되는 단어(내담자 이름, 기관 내부 명칭 등)는 `.garden-denylist.example.txt`를 `.garden-denylist.txt`로 복사해서 적어 둡니다. 이 파일은 git에 올라가지 않습니다.
- 일부러 공개한 내용이라면 `garden.local.json`의 `allowSensitive`에 파일 경로를 추가합니다.

## 주제 구역 바꾸기

사이트는 폴더가 아니라 **주제**로 둘러보게 되어 있습니다. 폴더는 볼트에서 일하는 방식이고, 방문자는 주제로 찾아 들어옵니다.

- **주제 허브:** 가든 맨 위(폴더 밖)에 있는 노트(`동기`, `수용` 등)가 주제 허브입니다. 허브에서 링크한 노트가 그 주제에 속합니다.
- **사이트 전용 허브:** `site/` 폴더 맨 위에 둔 노트(`상담 목표와 과정.md`, `일과 커리어.md` 등)도 허브가 됩니다. 볼트에 만들 필요가 없습니다. 이 허브에 속한 노트는 `garden.assignments.json`으로 정합니다.
- **숨긴 허브:** `garden.topics.json`의 `retiredHubs`(지금은 `임상 및 상담심리`, `라이팅`, `메모 및 글쓰기`)는 볼트에는 남아 있지만 사이트에서는 주제로 쓰지 않습니다. 페이지는 메뉴·검색·지도에서 빠지고, 노트는 다른 허브로 분류되어 있습니다.
- **주제 구역:** 허브를 어떤 구역으로 묶을지는 `garden.topics.json`의 `groups`에서 정합니다. 왼쪽 주제 메뉴와 정원 지도의 주제 버튼이 모두 이 파일을 읽습니다. 여기에 없는 허브는 "그 밖의 주제"로 들어갑니다.
- **노트 종류 배지:** 노트 제목 아래의 "문헌 메모", "의견" 같은 표시는 노트가 있는 맨 위 폴더 이름으로 정합니다(`garden.topics.json`의 `noteTypes`). 파일 이름 앞의 `P - `, `O - ` 같은 접두어는 사이트에서는 떼고 보여 줍니다. 볼트의 파일 이름은 그대로입니다.
- **태그:** 사이트 탐색에는 쓰지 않습니다. 주제는 허브가 맡습니다.

## 자동 실행 (매일 밤 11시)

Windows 작업 스케줄러의 `DigitalGarden-Publish` 작업이 매일 밤 11시에 `scripts/publish-garden.mjs`를 실행합니다. PC가 꺼져 있었으면 다음에 켜질 때 실행합니다. 기록은 `.garden/publish.log`에 남습니다.

1. 메인 볼트의 **`1. 문헌 메모`와 `2. 의견` 폴더만** 살펴봅니다. 가든에 올릴 노트는 이 두 폴더에 두고 머리말에 `publish: true`를 적습니다.
2. 새 노트 중 어느 주제 허브에도 속하지 않은 노트는 **제미나이(Gemini) API**로 자동 분류해 `garden.assignments.json`에 기록합니다. 키는 뉴스레터 폴더의 `.env`에 있는 `GEMINI_API_KEY`를 읽어 옵니다(`garden.local.json`의 `gemini.envFile`). 분류에 실패하면 배포는 그대로 진행하고, 그 노트는 다음 실행에서 다시 분류합니다.
3. 개인정보 검사를 통과하면 커밋·푸시하고, GitHub Actions가 사이트를 다시 배포합니다.

수동으로 바로 실행하려면 `npm run garden:publish`, 분류만 하려면 `npm run garden:classify`를 쓰면 됩니다. 작업을 멈추려면 작업 스케줄러에서 `DigitalGarden-Publish`를 사용 안 함으로 바꾸면 됩니다.

## 미분류 노트 정리 (Claude Code에 맡기기)

허브에 링크되지 않은 노트는 `garden.assignments.json`에 적힌 분류대로 사이트에서 허브에 붙습니다. 볼트의 허브 노트는 바뀌지 않습니다.

- `npm run garden:sync`나 `garden:publish`를 실행하면 마지막에 "미분류 N개"가 나옵니다.
- 미분류가 있으면 이 폴더에서 Claude Code에 **"미분류 정리해 줘"**라고 하면 됩니다. `.claude/skills/garden-classify`의 순서대로 노트를 읽고 `garden.assignments.json`에 추가합니다.
- 분류 결과의 `confidence`
  - `high`: 허브 페이지 아래 "이 주제의 다른 노트"에 붙습니다.
  - `low`: 확인 대기입니다. 사이트에 반영되지 않습니다. 맞으면 `high`로 바꾸면 됩니다.
  - `none`: 맞는 허브가 없는 노트입니다. `suggest`에 새 허브 후보가 적혀 있을 수 있습니다.
- 분류가 틀렸으면 그 노트의 `hubs`만 고치면 됩니다. 이미 있는 항목은 다시 분류하지 않습니다.

## 첫 화면의 "최근에 수정한 글"

동기화할 때마다 실제로 수정한 날짜가 가장 최근인 노트 8개로 자동으로 채웁니다. 날짜는 파일의 수정 시각과 머리말의 `updated`/`modified` 중 더 나중 것입니다.

옛 가든 노트(`import/old-garden/`)는 파일 시각이 수정일이 아니라 복사한 날이라서 `garden.sync.json`에서 `"recent": false`로 빼 두었습니다. 예전 복사일(`copyDate`: 2024-12-11)은 허브 목록의 날짜로도 쓰지 않습니다. 그 노트를 메인 볼트에서 공개하면 볼트의 수정일로 목록에 들어옵니다.

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
