# Architecture
- frontend (nginx static app) -> backend (express api) -> postgres
- documents are stored in FILE_STORAGE_PATH volume
- documents table stores file metadata and idea relationship
