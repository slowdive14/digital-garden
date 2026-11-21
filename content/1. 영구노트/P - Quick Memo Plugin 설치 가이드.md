---
publish: true
created: '2024-12-11'
modified: '2024-12-11'
noteType: 문헌 메모
title: Quick Memo Plugin 설치 가이드
---
# Quick Memo Plugin 설치 가이드 📝✨

## 1. Templater 플러그인 설치 🔌

1. Obsidian을 엽니다. 📂
2. 왼쪽 사이드바에서 설정(톱니바퀴 아이콘)을 클릭합니다. ⚙️
3. '커뮤니티 플러그인'을 선택합니다. 🔍
4. '안전 모드 해제'를 켭니다. 🔓
5. '찾아보기'를 클릭하고 검색창에 'Templater'를 입력합니다. 🔎
6. Templater 플러그인을 찾아 '설치'를 클릭합니다. 📥
7. 설치 후 Templater 플러그인을 활성화합니다. ✅

## 2. Quick Memo 스크립트 설정 🖋️

1. Obsidian의 볼트에서 새 파일을 만들고 이름을 지정합니다(예 QuickMemo.md). 📄
2. 아래의 스크립트를 파일에 복사하여 붙여넣습니다:

   ```
   <%*
   // 메모를 추가할 대상 파일의 경로를 지정합니다.
   const targetFilePath = "일간노트/Quick Memo.md"; // 원하는 경로 입력

   // 현재 날짜를 YYYYMMDD 형식으로 가져옵니다.
   const today = tp.date.now("YYYYMMDD");

   // 사용자로부터 메모 내용을 입력받습니다.
   const noteContent = await tp.system.prompt("Enter your note");

   // 대상 파일의 내용을 읽어옵니다.
   let fileContent = await app.vault.adapter.read(targetFilePath);

   // 오늘 날짜에 해당하는 섹션 헤더를 만듭니다.
   const dateHeader = `## ${today}`;

   // 새로운 메모 항목을 만듭니다.
   const newEntry = `- ${noteContent}`;

   // 본문 내용을 업데이트합니다.
   if (fileContent.includes(dateHeader)) {
       // 이미 오늘 날짜의 섹션이 있다면, 그 아래에 새 항목을 추가합니다.
       fileContent = fileContent.replace(dateHeader, `${dateHeader}\n${newEntry}`);
   } else {
       // 오늘 날짜의 섹션이 없다면, 본문 맨 위에 새 섹션과 항목을 추가합니다.
       fileContent = `${dateHeader}\n${newEntry}\n\n${fileContent}`;
   }

   // 업데이트된 내용을 파일에 씁니다.
   await app.vault.adapter.write(targetFilePath, fileContent);

   // 작업 완료 메시지를 표시합니다.
   new Notice("메모가 성공적으로 추가되었습니다!");
   %>
   ```

3. 파일을 저장합니다. 💾

## 3. Template Hotkeys 설정 ⚙️

1. Obsidian 설정으로 돌아갑니다. ⚙️
2. Templater 플러그인 설정을 엽니다. 🔧
3. 'Template Hotkeys' 섹션으로 스크롤합니다. 🖱️
4. 'Add New Template Hotkey'를 클릭합니다. ➕
5. 템플릿 파일 경로에 'QuickMemo.md'가 위치한 경로를 입력합니다. (예. Templates/Quick Memo Template.md)📄
6. 'Save'를 클릭하여 저장합니다. 💾

## 4. 단축키 설정 ⌨️

1. Obsidian 설정의 'Hotkeys' 섹션으로 이동합니다. 🔑
2. 검색창에 'Templater'를 입력합니다. 🔎
3. 'Templater: Insert QuickMemo.md'를 찾아 원하는 단축키를 지정합니다 (예: Ctrl+Shift+M). 🖱️

## 5. Quick Memo 사용하기 🚀

1. 지정한 단축키를 누릅니다 (예: Ctrl+Shift+M). ⌨️
2. 프롬프트가 뜨면 메모 내용을 입력합니다. ✏️
3. Enter를 누르면 메모가 지정된 파일에 자동으로 추가됩니다! 🎉

이제 Quick Memo 플러그인 설치가 완료되었습니다. 언제든지 빠르게 메모를 작성할 수 있습니다! 😊📚
