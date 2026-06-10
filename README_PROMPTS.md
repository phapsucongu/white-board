# Agent Prompt Pack - Realtime Collaborative Tactical Whiteboard

Bộ file này dùng để setup AI coding agent cho dự án **Realtime Collaborative Tactical Whiteboard**.

## Cách dùng nhanh

Copy toàn bộ các file/folder này vào root repo của bạn:

```txt
CLAUDE.md
.cursor/rules/realtime-whiteboard.mdc
.github/copilot-instructions.md
docs/agent/*
```

Sau đó khi làm với agent, luôn làm theo flow:

1. Mở `docs/agent/00_PROJECT_CONTEXT.md` cho agent đọc trước.
2. Mở `docs/agent/01_SYSTEM_PROMPT.md` làm system/project instruction.
3. Mỗi feature tạo 1 task từ `docs/agent/TASK_SPEC_TEMPLATE.md`.
4. Dùng prompt phù hợp:
   - Implement feature: `02_IMPLEMENT_FEATURE_PROMPT.md`
   - Review code: `03_REVIEW_PROMPT.md`
   - Viết test: `04_TEST_PROMPT.md`
   - Debug lỗi: `05_DEBUG_PROMPT.md`
   - Refactor: `06_REFACTOR_PROMPT.md`
   - DB/Prisma: `07_DATABASE_PROMPT.md`
   - Realtime sync: `08_REALTIME_SYNC_PROMPT.md`
   - Security/Auth: `09_SECURITY_PROMPT.md`
   - Update docs: `10_DOC_UPDATE_PROMPT.md`
5. Không giao task quá lớn. Mỗi prompt chỉ nên yêu cầu agent sửa/tạo tối đa 3-6 file.

## Nguyên tắc quan trọng

- Agent không được tự đổi stack nếu chưa được yêu cầu.
- Agent phải đọc docs trước khi code.
- Mọi thay đổi realtime phải có schema payload rõ ràng.
- Mọi thay đổi backend phải có validation + authorization.
- Mọi thay đổi quan trọng phải có test hoặc ít nhất test plan.
- Không implement nhiều feature lớn trong một lần prompt.
