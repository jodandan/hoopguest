# 훕게스트 (hoopguest) — 농구 게스트 모아보기 (비공식)

> 사이트: https://hoopguest.kro.kr (옛 주소 bdrguest.kro.kr은 자동 이동)

다음카페 [BDR]동아리농구방 **게스트 구인** 게시판의 공개 글 **제목**만 30분마다 수집해, 지역·날짜·시간대로 필터링해 보는 사이트.

- 본문·비용·작성자·연락처는 수집하지 않습니다. 모든 글은 원문 링크로 연결됩니다.
- 게시글 제외 요청은 이 저장소의 Issues에 남겨주세요.

## 구조
```
scraper/parser.mjs   제목 → 지역/날짜/시간 파서
scraper/scrape.mjs   목록 수집 → docs/data.json
docs/index.html      사이트 (GitHub Pages)
.github/workflows/scrape.yml  30분마다 수집·커밋
```

## 로컬 실행
```
node scraper/scrape.mjs      # Node 20+
cd docs && python3 -m http.server 8000
```
