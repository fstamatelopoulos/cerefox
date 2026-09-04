import { Loader } from "@mantine/core";
import { IconArrowLeft } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { apiFetch } from "../api/client";
import type { ProjectDocumentsResponse } from "../api/types";
import { CliHint } from "../components/CliHint";
import { PaginationFoot } from "../components/PaginationFoot";
import { useProjects } from "../hooks/useProjects";
import { useRowsPerPage } from "../hooks/useRowsPerPage";
import { formatDate } from "../utils/dates";
import ui from "../styles/redesign.module.css";
import lp from "../components/ListPage.module.css";

export function ProjectDocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

  const project = projects?.find((p) => p.id === id);
  const projectMap = new Map(projects?.map((p) => [p.id, p.name]) ?? []);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useRowsPerPage();
  const offset = (page - 1) * pageSize;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["project-documents", id, page, pageSize],
    queryFn: () =>
      apiFetch<ProjectDocumentsResponse>(
        `/projects/${id}/documents?limit=${pageSize}&offset=${offset}`,
      ),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });

  const docs = data?.documents ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={lp.wrap}>
      <button
        type="button"
        className={`${ui.btn} ${ui.btnSubtle}`}
        style={{ marginBottom: 12, paddingLeft: 6 }}
        onClick={() => navigate("/projects")}
      >
        <IconArrowLeft size={15} />
        Projects
      </button>

      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>Memory space</p>
          <h1 className={ui.pageTitle}>{project?.name || "Project"}</h1>
          {project?.description && <p className={ui.pageSub}>{project.description}</p>}
        </div>
        <CliHint cmd="cerefox document list" args={`--project "${project?.name ?? "<name>"}"`} />
      </div>

      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 40 }}>
          <Loader />
        </div>
      ) : total === 0 ? (
        <div className={`${ui.card} ${lp.emptyRow}`}>No documents in this project.</div>
      ) : (
        <div className={`${ui.card} ${ui.rise}`} style={{ overflow: "hidden" }}>
          <table className={lp.tbl}>
            <thead>
              <tr>
                <th>Document</th>
                <th style={{ width: 90, textAlign: "right" }}>Chunks</th>
                <th style={{ width: 110, textAlign: "right" }}>Size</th>
                <th style={{ width: 120, textAlign: "right" }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => {
                const pending = doc.review_status === "pending_review";
                return (
                  <tr
                    key={doc.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => navigate(`/document/${doc.id}`)}
                  >
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className={ui.link} style={{ fontSize: 13.5 }}>
                          {doc.title || "Untitled"}
                        </span>
                        {doc.project_ids
                          .filter((pid) => pid !== id && projectMap.has(pid))
                          .map((pid) => (
                            <span key={pid} className={`${ui.badge} ${ui.bNeutral}`}>
                              {projectMap.get(pid)}
                            </span>
                          ))}
                        {pending && (
                          <span className={`${ui.badge} ${ui.bYellow}`}>
                            <span
                              style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }}
                            />
                            pending review
                          </span>
                        )}
                      </span>
                    </td>
                    <td className={`${ui.mono} ${ui.dim}`} style={{ textAlign: "right" }}>
                      {doc.chunk_count}
                    </td>
                    <td className={`${ui.mono} ${ui.dim}`} style={{ textAlign: "right" }}>
                      {doc.total_chars.toLocaleString()}
                    </td>
                    <td className={`${ui.faint}`} style={{ textAlign: "right" }}>
                      {formatDate(doc.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <PaginationFoot
            page={page}
            pageCount={totalPages}
            total={total}
            pageSize={pageSize}
            onPage={setPage}
            onPageSize={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            loading={isFetching && !isLoading}
          />
        </div>
      )}
    </div>
  );
}
