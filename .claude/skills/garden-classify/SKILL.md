---
name: garden-classify
description: 디지털 가든의 미분류 노트를 주제 허브에 배정한다. "미분류 정리해 줘", "주제 분류해 줘", "새 노트 분류" 같은 요청에 사용. garden.assignments.json을 갱신하고 사이트에 반영한다.
---

# 미분류 노트 정리

가든 노트를 주제 허브(가든 맨 위의 노트들)에 배정한다. 볼트는 건드리지 않고 `garden.assignments.json`만 고친다.

## 순서

1. `npm run garden:sync`를 실행해 최신 상태로 만든다. 출력의 "미분류 N개"를 확인한다.
2. `.garden/unassigned.md`를 읽는다. 맨 위에 현재 허브 목록이 있다. 허브가 다루는 범위가 애매하면 `content/<허브>.md`를 읽어 본다.
3. 노트마다 제목과 앞부분을 보고 판단한다. 필요하면 `content/` 아래 원문을 더 읽는다.
   - 허브 0~2개를 고른다. 가장 잘 맞는 것을 먼저 쓴다.
   - `confidence`
     - `high`: 내용이 그 허브의 중심 주제와 분명히 맞는다. 사이트에 바로 반영된다.
     - `low`: 맞을 수도 있지만 애매하다. 반영되지 않고 확인 대기로 남는다.
     - `none`: 맞는 허브가 없다. `hubs`는 빈 배열로 둔다.
   - 여러 노트가 같은 빈 주제를 가리키면 `suggest`에 새 허브 후보 이름을 적는다. 기존 후보 이름(`garden.assignments.json`에서 `suggest` 값을 찾아 볼 것)과 같은 이름을 쓴다.
4. `garden.assignments.json`의 `notes`에 항목을 추가한다. 키는 노트 파일 이름(확장자 제외)이다. 이미 있는 항목은 사용자가 고친 것일 수 있으니 바꾸지 않는다.

   ```json
   "P - 노트 파일 이름": {
     "title": "사이트에 보이는 제목",
     "hubs": ["동기"],
     "confidence": "high"
   }
   ```

5. `npm run garden:sync`를 다시 실행해 "미분류 0개"를 확인한다.
6. 사용자에게 몇 개를 어디에 배정했는지, 확인 대기와 새 허브 후보가 있는지 짧게 알린다. 배포는 사용자가 `npm run garden:publish`로 한다.

## 허브 이름

허브 이름은 반드시 `.garden/unassigned.md` 맨 위 목록에 있는 것만 쓴다. 없는 허브를 쓰면 동기화가 경고를 낸다.
