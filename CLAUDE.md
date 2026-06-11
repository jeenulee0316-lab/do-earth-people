@AGENTS.md

# Onloop

## 📌 Project Overview
- **프로젝트 배경:** 'Tech for Impact' 수업의 일환으로 서울환경연합과 협업하여 진행하는 소셜 임팩트 프로젝트입니다.
- **서비스 대상:** 한국에 머무는 교환학생들을 위한 지속 가능한 순환 경제(Circular Economy) 플랫폼입니다.
- **핵심 가치:** '넛지(Nudge)' 이론을 적용하여, 사용자들이 복잡한 과정 없이 쉽고 긍정적인 경험으로 물품 기부와 수령(순환)에 참여할 수 있도록 유도합니다.

## 👥 Team & Collaboration Context
- **팀 구성:** 엔지니어링 전공자 외에도 인문계열 등 다양한 전공의 팀원들이 함께 기획하고 진행합니다.
- **코드 작성 규칙:** 비전공자 팀원들도 코드 리뷰나 로직 파악을 쉽게 할 수 있도록, 핵심 함수, API 호출부, 복잡한 UI 컴포넌트 위에는 반드시 직관적이고 쉬운 한글 주석을 상세히 달아주세요.

## 🛠️ Tech Stack
- **Frontend:** Next.js (App Router), React, Tailwind CSS
- **Backend/DB:** Supabase (Auth, PostgreSQL)
- **AI:** Anthropic SDK (Claude 3.5 Sonnet)

## ✅ Completed Features (기 구현 완료된 기능)
- **사용자 인증 (Supabase Auth):** 연세대학교 이메일(`@yonsei.ac.kr`) 전용 가입 및 매직 링크(Magic Link) 로그인 구현 완료.
- **자동 프로필 생성:** 가입 시 DB 트리거를 통한 프로필 생성 및 온보딩(기부자/수령자 역할 선택) 로직 구축.
- **AI 일괄 입력 UI:** 사용자가 텍스트로 물품을 나열하면 AI가 카테고리를 분류하고 금지 품목을 필터링하는 프론트엔드 UI 구축 완료.

## ⚠️ Development Rules & Current Environment
1. **비용 효율화 (Mocking 모드 유지):** 
   - 현재 API 비용 관리를 위해 `.env.local`의 `NEXT_PUBLIC_USE_MOCK_AI=true` 변수를 활용, AI 분석 결과를 가짜 데이터(Mock)로 띄우고 있습니다.
   - 새로운 기능을 추가할 때 이 Mocking 스위치 로직을 훼손하지 마세요.
2. **정책 기반 필터링:**
   - 의약품, 칼 등 위험/반입 불가 물품은 AI 분석 단계에서 철저히 `rejected` 리스트로 분류되도록 정책을 유지하세요.
3. **UI/UX 디자인 시스템:** 
   - Tailwind CSS를 사용하여 '떠나는 짐이 머무는 선물이 되는' 서비스 가치에 맞게 깔끔하고 신뢰감을 주는 UI를 구성하세요.

## 🎯 Current Focus & Next Steps
- **1단계 (현재):** AI가 분류한 물품 리스트(`recognizedItems`) 옆에 상태(Condition: S, A, B 등급)를 선택할 수 있는 드롭다운 UI 추가.
- **2단계:** 상태 선택이 완료된 물품들을 Supabase `items` 테이블에 로그인된 유저 정보와 함께 저장하는 기능.
- **3단계 (차후 로드맵):** 등록된 물품을 수령자(Receiver)가 탐색하고 예약할 수 있는 기능.