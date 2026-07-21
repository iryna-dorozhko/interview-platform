# HR and Candidate Chat and Vacancies Design

## Goal

Improve HR and candidate navigation and chat layouts, expose the company name in candidate vacancy matches, and clearly identify Company Agent messages.

## Scope

### 1. Full-width HR Company Agent chat

The vacancy preparation chat in `VacancyPrepView.vue` will use the full width available inside `HrLayout`, matching the existing candidate preparation chat.

- `.page`: `width: 100%` and `min-width: 0`; remove the fixed `max-width`.
- `.messages`: `max-height: calc(100vh - 14rem)` and `min-height: 20rem`.
- No route, API, or backend changes.

### 2. Company name in profile and candidate vacancy matches

`HrCompanyProfile` is the source of truth for the current company name.

- Add nullable `companyName` to `HrCompanyProfile` so the migration is safe for existing rows.
- Add `companyName` to company-profile extraction, DTOs, GET/PATCH/confirm flows, frontend API types, and the company profile form.
- A new profile cannot be confirmed without a non-empty company name.
- A confirmed company profile remains editable in full, including `companyName`.
- Candidate match enrichment reads the current name through `Vacancy.hrUser.hrCompanyProfile`.
- Candidate match API and frontend types expose `companyName`.
- Candidate vacancy cards display the company name with the vacancy title.
- Existing profiles without a company name use the UI fallback `Компанія` until HR supplies a name.
- The name is not copied into `Vacancy` or the vacancy-specific company profile; changes apply to all vacancies immediately.

### 3. Available vacancies candidate tab

The existing candidate match page becomes a permanent cabinet destination.

- Add `Доступні вакансії` to `CandidateSidebar.vue`.
- Place it after `Моя анкета` and before `Співбесіда`.
- Link to the existing `/candidate/matches` route and apply the normal active state.
- Rename the page heading from `Підбір вакансій` to `Доступні вакансії`.
- If the candidate questionnaire is not confirmed, show an actionable message directing the candidate to complete it instead of exposing a raw 403 error.

### 4. Company Agent message label

Keep the persisted and socket author type `AGENT_COMPANY` unchanged. Change only its centralized frontend display label in `live-message-styles.ts` to `Компанія (АІ)`. Both HR and candidate live chat views inherit the label through `LiveChatPanel.vue`.

The thinking status, agent status sidebar, report transcript labels, database schema, and socket payloads remain unchanged.

### 5. Taller shared live chat

Increase the shared `LiveChatPanel.vue` message area for both HR and candidate views.

- `.messages`: `max-height: calc(100vh - 16rem)` and `min-height: 20rem`.
- Preserve internal scrolling and automatic scroll-to-bottom behavior.
- Do not duplicate role-specific CSS in HR or candidate room views.

## Data Flow

```text
Company profile agent/form
  -> company-prep API
  -> HrCompanyProfile.companyName
  -> Vacancy.hrUser.hrCompanyProfile.companyName
  -> candidate match enrichment and API payload
  -> CandidateMatchesView vacancy card
```

## Error Handling and Compatibility

- The database migration keeps `companyName` nullable to avoid breaking existing company profiles.
- New confirmation requests reject a missing or blank name with a validation response.
- Existing confirmed profiles can be edited, allowing gradual data completion.
- Candidate cards tolerate historical null values and show `Компанія`.
- Existing candidate match cache entries are enriched from current vacancy/profile data, so no cache migration is required.
- CSS changes remain inside existing responsive layouts; narrow layouts continue to stack as they do today.

## Testing

- Follow test-driven development for backend behavior.
- Extend company profile agent and route tests for extraction, validation, confirmation, and editing confirmed profiles.
- Extend vacancy-match and candidate-match route tests for `companyName`, including the fallback-compatible null case.
- Run relevant backend test files and the frontend build/lint checks.
- Browser-check:
  - full-width vacancy prep chat;
  - candidate sidebar and unconfirmed-questionnaire state;
  - company name on vacancy cards;
  - `Компанія (АІ)` in HR and candidate live chat;
  - live chat height at desktop and narrow viewport sizes.

## Delivery

Each numbered scope item is implemented by a separate subagent. Tasks that may touch related candidate-match files are executed sequentially, followed by an integration review and verification of the combined result.
