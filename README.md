# 아산 둔포면 아파트 시장 대시보드

**내집멘토부동산** · 아산 둔포 전문 공인중개사사무소 · ☎ 041-545-7771

아산시 둔포면 아파트의 매매·전세·월세 실거래가, 리별 단지 목록, TOP 10 지도, 추천매물, 단지별 입지분석(교통·학군·상권·개발계획)과 한국부동산원 가격지수·미분양·거래량을 한 화면에서 보는 브리핑용 대시보드입니다.

## 자료 출처
- 국토교통부 아파트 매매·전월세 실거래가 (공공데이터포털)
- 한국부동산원 R-ONE 부동산통계 (주간 가격지수, 미분양, 아파트 거래현황, 매매수급동향)
- 지도 © OpenStreetMap contributors, 위성 © Esri

공개 사이트는 GitHub Actions가 매일 07시(KST)에 최신 자료로 다시 만듭니다.

## 로컬에서 실행 (최신 자료 실시간 조회)
1. [Node.js](https://nodejs.org) 설치
2. `config.local.example.json`을 `config.local.json`으로 복사하고 API 키 입력
3. `start.bat` 더블클릭 → http://localhost:8787

## 추천매물 수정
`data.js`의 `listings` 항목을 고치면 공개 사이트에 반영됩니다. (단지 `key`는 `"리|지번"` 형식)

## 배포 설정 (최초 1회)
- 저장소 Settings → Secrets and variables → Actions 에 `DATA_GO_KEY`, `REB_KEY` 등록
- Settings → Pages → Source 를 **GitHub Actions** 로 선택

> 실거래가는 계약일 기준이며 신고기한(30일)으로 최근 자료는 추가될 수 있습니다. 입지·개발계획은 공개 자료 요약이며 거리는 직선거리 기준 추정치입니다.
