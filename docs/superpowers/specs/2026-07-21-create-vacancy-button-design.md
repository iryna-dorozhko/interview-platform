# Create Vacancy Button — Design

Date: 2026-07-21

## Goal

Make vacancy creation reachable from the Vacancies tab and align HR home CTA wording with “vacancy” (not “questionnaire”).

## Scope

In scope:

1. On HR home (`HrHomeView`), rename the primary CTA from «Створити нову анкету» to «Створити нову вакансію».
2. On Vacancies tab (`VacancyListView`), add a primary button «Створити вакансію» near the page title.
3. Both CTAs open the existing `CreateVacancyModal` and, on success, navigate to `vacancy-prep` for the new vacancy id.

Out of scope:

- Renaming other “анкета” copy across the app
- Backend/API changes
- New routes or a shared composable for modal state

## Approach

Reuse `CreateVacancyModal` locally in `VacancyListView` the same way `HrHomeView` already does (`showVacancyModal` + `@created` → `router.push` to prep).

## UI details

- Home button label: «Створити нову вакансію»
- Vacancies button label: «Створити вакансію»
- Placement on Vacancies: header row with `h1` «Вакансії» and the create button (primary style consistent with home)
- Empty-state hint on Vacancies: change from «Створіть першу на головній сторінці» to something like «Натисніть «Створити вакансію», щоб додати першу» so it matches the new CTA

## Success criteria

- From Vacancies, HR can create a vacancy without going to home
- From home, the CTA clearly says “vacancy”
- After create, HR lands on the vacancy prep chat for the new item
