# ServerCraft 전용 Minecraft 런처

Windows용 Minecraft Java Edition 서버 전용 런처의 기본 구현입니다.

## 구현된 기능

- 바닐라, Fabric, Forge, Quilt, NeoForge 설치 및 실행
- Microsoft 정품 계정 Device Code 로그인
- `%appdata%/<런처이름>/game`에 독립 게임 폴더 생성
- 필요한 Java 런타임 자동 설치
- 모드, 리소스팩, 설정 파일 등 서버 배포 파일 자동 설치
- SHA-256 기반 파일 무결성 검사와 허용되지 않은 파일 차단
- 게임 언어, 키 설정, 리소스팩 설정 자동 적용
- 서버 온라인 상태, MOTD, 플레이어 수, 핑 표시
- 설정에 따라 게임 실행 후 서버 자동 접속
- 사용자가 게임 폴더의 모든 파일을 직접 열고 수정 가능
- Windows 보안 저장소로 계정 토큰 암호화

## 먼저 알아둘 점

클라이언트 파일 검사만으로 핵 클라이언트나 엑스레이를 완전히 막을 수는 없습니다.
사용자는 수정된 런처를 만들거나 게임 실행 후 메모리를 변조할 수 있기 때문입니다.

강제하려면 다음 3개가 함께 필요합니다.

1. 이 런처의 파일 무결성 검사
2. 런처 세션을 서버로 전달하는 클라이언트 동반 모드
3. 세션 서명을 검증하고 미인증 접속을 차단하는 서버 플러그인 또는 서버 모드

연동 규격은 [docs/SECURITY.md](docs/SECURITY.md)에 있습니다.

## 개발 실행

필요 프로그램:

- Node.js 20 이상
- Windows 10/11

```powershell
npm.cmd install
npm.cmd start
```

## 기본 설정

[`launcher-config.json`](launcher-config.json)을 수정합니다.

주요 항목:

```json
{
  "launcherName": "ServerCraft",
  "server": {
    "name": "서버 이름",
    "host": "play.example.com",
    "port": 25565,
    "autoConnect": true,
    "acceptResourcePacks": true
  },
  "minecraft": {
    "version": "1.21.5",
    "loader": "fabric",
    "loaderVersion": "",
    "minMemoryMb": 2048,
    "maxMemoryMb": 6144,
    "javaMajor": 21
  }
}
```

`loader` 값:

- `vanilla`
- `fabric`
- `forge`
- `quilt`
- `neoforge`

Fabric, Forge, Quilt에서 `loaderVersion`을 비워두면 호환되는 안정 또는 최신 버전을
자동 선택합니다. NeoForge는 정확한 `loaderVersion`을 입력해야 합니다.

Minecraft 버전에 맞는 Java 메이저 버전을 설정해야 합니다.

- 오래된 버전: Java 8
- 1.17 계열: Java 16
- 1.18~1.20.4: Java 17
- 1.20.5 이상: Java 21

모드팩이 요구하는 Java 버전이 다르면 해당 모드팩 기준을 우선합니다.

## Microsoft 정품 로그인 설정

런처마다 Microsoft Entra 애플리케이션 ID가 필요합니다.

1. Microsoft Entra 관리 센터에서 앱 등록을 생성합니다.
2. 지원 계정 유형은 개인 Microsoft 계정을 포함하도록 설정합니다.
3. `공용 클라이언트 흐름 허용`을 활성화합니다.
4. 앱의 `Application (client) ID`를 복사합니다.
5. `launcher-config.json`의 `microsoft.clientId`에 입력합니다.

런처는 비밀번호를 직접 받지 않습니다. 로그인 버튼을 누르면 Microsoft 브라우저
로그인 페이지와 1회용 코드가 표시됩니다.

## 모드와 설정 파일 배포

배포할 파일을 임시 `pack` 폴더에 게임 폴더 구조대로 놓습니다.

```text
pack/
  mods/
    example-mod.jar
  resourcepacks/
    server-resources.zip
  config/
    example.toml
  options.txt
```

manifest 생성:

```powershell
npm.cmd run manifest -- pack manifest.json https://cdn.example.com/servercraft/files
```

생성된 `manifest.json`과 `pack` 내부 파일을 웹 서버 또는 CDN에 같은 구조로
업로드합니다. 그다음 `launcher-config.json`의
`distribution.manifestUrl`을 업로드한 manifest 주소로 변경합니다.

`strictMode`가 `true`이면 `watchDirectories` 안에서 manifest에 없는 파일을
감지해 접속을 차단하고, 실행 시 제거합니다. 개인 설정처럼 유지할 파일은
`ignoredFiles`에 추가합니다. 예외 파일은 manifest에 포함되어 있어도 검사하거나
다운로드하지 않습니다. `server.dat`는 항상 보존됩니다.

사용자는 런처의 `게임 폴더` 버튼으로 모든 파일을 직접 수정할 수 있습니다.
다만 관리 대상 파일을 수정한 경우 다음 실행에서 원본으로 복구됩니다.

## 게임 설정 자동 적용

`launcher-config.json`의 `gameOptions`를 수정합니다.

```json
{
  "gameOptions": {
    "applyMode": "once",
    "lang": "ko_kr",
    "resourcePacks": ["file/server-resources.zip"],
    "incompatibleResourcePacks": [],
    "keyBindings": {
      "key.jump": "key.keyboard.space",
      "key.sprint": "key.keyboard.left.control"
    }
  }
}
```

마인크래프트 버전에 따라 키 이름이나 값 형식이 다를 수 있으므로 해당 버전의
`options.txt` 형식을 사용해야 합니다.

`applyMode` 값:

- `once`: 설정 내용이 변경된 뒤 첫 게임 실행에만 적용하고 이후 사용자 수정을 유지
- `always`: 게임을 실행할 때마다 지정한 설정을 다시 적용
- `never`: 런처에서 `options.txt`를 수정하지 않음

`once` 모드에서는 `lang`, `resourcePacks`, `incompatibleResourcePacks`,
`keyBindings` 중 하나라도 원격 설정에서 바뀌면 새로운 설정으로 인식합니다.
업데이트 후 첫 실행에 한 번 적용된 뒤에는 사용자가 `options.txt`를 수정해도
다음 실행에서 초기화되지 않습니다.

설정 화면의 `서버 리소스팩 자동 적용`을 켜면 게임 실행 전에 해당 서버의
`servers.dat` 항목을 리소스팩 허용 상태로 갱신합니다. 서버에서도
`server.properties`의 `resource-pack`과 `resource-pack-sha1`을 올바르게 설정해야
실제 리소스팩이 전송됩니다.

`options.txt`와 `servers.dat`는 `onceFiles`에 포함되어 있으므로 각 원격 파일이
변경된 뒤 첫 실행에만 배포본을 적용하고 이후 사용자 수정을 유지합니다.
`onceFiles`는 `ignoredFiles`보다 우선합니다.

## 설치 파일 만들기

macOS에서는 Mojang 런타임의 `jre.bundle/Contents/Home/bin/java` 구조를 자동으로
탐색하고 manifest에 지정된 실행 파일 권한을 설치 후 복구합니다. Mojang 런타임
검증에 실패하면 Eclipse Temurin 21 JRE를 공식 API에서 받아 자동으로 대체합니다.

```powershell
npm.cmd run build
```

결과물은 `dist` 폴더에 생성됩니다.

## 자동 업데이트 배포

자동 업데이트는 설치형 런처에서 지원합니다. 포터블 EXE는 실행 중인 자기 자신을
안전하게 교체하기 어려우므로 자동 설치 대상이 아닙니다.

이 프로젝트는 GitHub를 다음처럼 사용합니다.

- GitHub Releases: 설치형, 포터블, `latest.yml`, blockmap
- GitHub Pages: 원격 설정, 모드 manifest, 모드·리소스팩·설정 파일
- GitHub Actions: Windows 빌드와 Pages 배포 자동화

### 최초 GitHub 설정

1. GitHub에서 `BongLauncher` 저장소를 생성합니다.
2. GitHub 사용자명과 저장소명을 프로젝트에 적용합니다.

```powershell
npm.cmd run github:configure -- YOUR_GITHUB_USERNAME BongLauncher
```

3. 프로젝트 전체를 저장소의 `main` 브랜치에 업로드합니다.
4. GitHub 저장소의 `Settings → Pages → Build and deployment`에서
   `Source`를 `GitHub Actions`로 설정합니다.
5. `Actions` 탭에서 `Deploy Launcher Data` 워크플로를 한 번 실행합니다.

Pages 주소:

```text
https://YOUR_GITHUB_USERNAME.github.io/BongLauncher/
```

### 새 런처 버전 배포

1. `package.json`의 `version`을 올립니다. 예: `0.2.0` → `0.2.1`
2. 변경 사항을 GitHub에 업로드합니다.
3. 버전과 같은 태그를 생성해 푸시합니다.

```powershell
git tag v0.2.1
git push origin v0.2.1
```

`Release BongLauncher` 워크플로가 Windows 실행 파일을 빌드하고 GitHub Release에
자동으로 첨부합니다. 설치형 사용자는 런처 실행 시 새 Release를 감지합니다.

처음 자동 업데이트 기능이 들어간 `0.2.0` 버전은 사용자가 한 번 직접 설치해야
합니다. 그 이후 버전부터 자동 업데이트됩니다.

### 원격 런처 설정

`pages/launcher-config.json`을 수정해 서버 버전과 로더를 바꿀 수 있습니다.
런처를 다시 빌드하지 않아도 다음 실행부터 적용됩니다.

원격으로 변경 가능한 항목:

- `server`
- `minecraft`
- `distribution`
- `gameOptions`
- `security`

Microsoft Client ID와 자동 업데이트 서버 주소는 보안을 위해 원격 설정에서
덮어쓰지 않습니다.

### 모드팩 업데이트

배포할 파일을 `pack` 폴더에 넣고 manifest를 생성합니다.

`pack` 내부 구조:

```text
pack/
  mods/
  resourcepacks/
  config/
  shaderpacks/
```

파일을 `pack`에 넣고 `main` 브랜치에 푸시하면 `Deploy Launcher Data` 워크플로가
manifest를 생성하고 GitHub Pages에 자동 배포합니다.

사용자가 게임 시작 버튼을 누르면 변경된 모드, 리소스팩, 설정 파일을 검사하고
자동으로 내려받습니다.

배포 전 필수 작업:

- `launcher-config.json`의 예제 주소 교체
- Microsoft client ID 설정
- 실제 manifest URL 설정
- Windows 코드 서명 인증서 적용
- 서버 연동 보안 모드 또는 플러그인 설치

## 사용자 사용법

1. 런처 설치 파일을 실행합니다.
2. `Microsoft 로그인`을 누르고 브라우저에서 정품 계정으로 로그인합니다.
3. `설치 및 플레이`를 누릅니다.
4. 첫 실행에서는 Java, Minecraft, 모드 로더, 서버 파일을 자동 설치합니다.
5. 자동 접속이 켜져 있으면 게임 로딩 후 설정된 서버로 이동합니다.
6. 파일을 직접 수정하려면 `게임 폴더`를 누릅니다.
7. 접속이 차단되면 `파일 검사` 후 다시 `설치 및 플레이`를 눌러 복구합니다.

게임 데이터 위치:

```text
%appdata%\<launcherName>\game
```

예제 기본값:

```text
%appdata%\ServerCraft\game
```
