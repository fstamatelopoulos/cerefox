import { Route, Routes } from "react-router-dom";

import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { DocumentEditPage } from "./pages/DocumentEditPage";
import { DocumentPage } from "./pages/DocumentPage";
import { IngestPage } from "./pages/IngestPage";
import { ProjectDocumentsPage } from "./pages/ProjectDocumentsPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SearchPage } from "./pages/SearchPage";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/document/:id" element={<DocumentPage />} />
        <Route path="/document/:id/edit" element={<DocumentEditPage />} />
        <Route path="/ingest" element={<IngestPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id/documents" element={<ProjectDocumentsPage />} />
      </Route>
    </Routes>
  );
}
