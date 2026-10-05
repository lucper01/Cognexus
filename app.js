(() => {
  "use strict";

  const STORAGE_KEY = "cognexus.project.v1";
  const THEME_KEY = "cognexus.theme";

  const TYPES = {
    concept:    { label: "Concept", color: "#4f7c67", shape: "ellipse" },
    article:    { label: "Article", color: "#61799b", shape: "round-rectangle" },
    hypothesis: { label: "Hypothèse", color: "#9b6f45", shape: "diamond" },
    experiment: { label: "Expérience", color: "#7a689c", shape: "hexagon" },
    result:     { label: "Résultat", color: "#9a5656", shape: "round-rectangle" },
    section:    { label: "Section", color: "#657078", shape: "rectangle" }
  };

  const STATUS_LABELS = {
    established: "Établi",
    hypothetical: "Hypothétique",
    "to-check": "À vérifier"
  };

  const $ = (id) => document.getElementById(id);
  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  let state = loadState();
  let selectedNodeId = null;
  let editingNewNode = false;
  let activeTypes = new Set(Object.keys(TYPES));
  let deferredInstallPrompt = null;
  let toastTimer = null;
  let cy = null;

  function freshState() {
    return {
      schemaVersion: 1,
      project: {
        name: "Mon projet de recherche",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      nodes: [],
      edges: []
    };
  }

  function demoState() {
    const s = freshState();
    s.project.name = "Exemple Cognexus";
    s.nodes = [
      { id: "demo_concept", title: "Concept central", type: "concept", status: "established", summary: "Phénomène théorique au cœur du projet.", tags: ["théorie"], reference: "", url: "", notes: "" },
      { id: "demo_article", title: "Article fondateur", type: "article", status: "established", summary: "Référence qui définit le cadre initial.", tags: ["bibliographie"], reference: "Auteur et al. (2024)", url: "", notes: "" },
      { id: "demo_hypothesis", title: "Hypothèse principale", type: "hypothesis", status: "hypothetical", summary: "Prédiction dérivée du cadre théorique.", tags: ["hypothèse"], reference: "", url: "", notes: "" },
      { id: "demo_experiment", title: "Expérience 1", type: "experiment", status: "established", summary: "Paradigme utilisé pour tester l’hypothèse.", tags: ["méthode"], reference: "", url: "", notes: "" },
      { id: "demo_result", title: "Résultat principal", type: "result", status: "to-check", summary: "Résultat à interpréter et à relier au cadre théorique.", tags: ["résultat"], reference: "", url: "", notes: "" },
      { id: "demo_section", title: "Discussion générale", type: "section", status: "hypothetical", summary: "Section du manuscrit dans laquelle le résultat sera discuté.", tags: ["manuscrit"], reference: "", url: "", notes: "" }
    ];
    s.edges = [
      { id: "e1", source: "demo_article", target: "demo_concept", relation: "supports", label: "soutient" },
      { id: "e2", source: "demo_concept", target: "demo_hypothesis", relation: "derived from", label: "fonde" },
      { id: "e3", source: "demo_experiment", target: "demo_hypothesis", relation: "tests", label: "teste" },
      { id: "e4", source: "demo_result", target: "demo_experiment", relation: "derived from", label: "issu de" },
      { id: "e5", source: "demo_result", target: "demo_section", relation: "discussed in", label: "discuté dans" }
    ];
    return s;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return freshState();
      return parsed;
    } catch {
      return freshState();
    }
  }

  function saveState(message = "Sauvegardé localement") {
    state.project.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $("saveState").textContent = message;
    window.setTimeout(() => $("saveState").textContent = "Sauvegardé localement", 1000);
  }

  function init() {
    populateNodeTypes();
    renderTypeFilters();
    bindUI();
    applyTheme(localStorage.getItem(THEME_KEY) || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
    $("projectName").value = state.project.name || "Mon projet de recherche";

    if (typeof cytoscape !== "function") {
      $("emptyState").classList.add("visible");
      $("emptyState").querySelector("h2").textContent = "Impossible de charger le moteur du graphe";
      $("emptyState").querySelector("p").textContent = "Vérifiez la connexion réseau puis rechargez la page.";
      return;
    }

    cy = cytoscape({
      container: $("cy"),
      elements: graphElements(),
      minZoom: 0.18,
      maxZoom: 2.8,
      wheelSensitivity: 0.18,
      style: graphStyle(),
      layout: { name: "cose", animate: false, fit: true, padding: 70, nodeRepulsion: 420000, idealEdgeLength: 125 }
    });

    cy.on("tap", "node", (evt) => openNode(evt.target.id()));
    cy.on("tap", (evt) => {
      if (evt.target === cy) closeInspector();
    });
    cy.on("dbltap", "node", (evt) => openNode(evt.target.id()));

    refreshAll(false);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  function graphElements() {
    const nodes = state.nodes.map(n => ({
      data: {
        id: n.id,
        label: n.title || "Sans titre",
        type: n.type,
        status: n.status,
        color: TYPES[n.type]?.color || "#6a756f",
        shape: TYPES[n.type]?.shape || "ellipse"
      }
    }));
    const edges = state.edges
      .filter(e => state.nodes.some(n => n.id === e.source) && state.nodes.some(n => n.id === e.target))
      .map(e => ({ data: { id: e.id, source: e.source, target: e.target, label: e.label || e.relation || "lié à" } }));
    return [...nodes, ...edges];
  }

  function graphStyle() {
    return [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "shape": "data(shape)",
          "label": "data(label)",
          "color": getComputedStyle(document.documentElement).getPropertyValue("--text").trim(),
          "font-size": 11,
          "font-weight": 600,
          "text-wrap": "wrap",
          "text-max-width": 125,
          "text-valign": "bottom",
          "text-margin-y": 9,
          "width": 42,
          "height": 42,
          "border-width": 2,
          "border-color": "data(color)",
          "overlay-opacity": 0
        }
      },
      {
        selector: "node:selected",
        style: {
          "border-width": 5,
          "border-color": getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
          "width": 48,
          "height": 48
        }
      },
      {
        selector: "edge",
        style: {
          "width": 1.5,
          "line-color": getComputedStyle(document.documentElement).getPropertyValue("--line").trim(),
          "target-arrow-color": getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "label": "data(label)",
          "font-size": 8,
          "color": getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(),
          "text-background-color": getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
          "text-background-opacity": 0.9,
          "text-background-padding": 3,
          "text-rotation": "autorotate",
          "arrow-scale": .75
        }
      },
      { selector: ".filtered", style: { "display": "none" } }
    ];
  }

  function populateNodeTypes() {
    $("nodeType").innerHTML = Object.entries(TYPES)
      .map(([value, meta]) => `<option value="${value}">${meta.label}</option>`).join("");
  }

  function renderTypeFilters() {
    const counts = Object.fromEntries(Object.keys(TYPES).map(k => [k, 0]));
    state.nodes.forEach(n => { if (counts[n.type] !== undefined) counts[n.type]++; });
    $("typeFilters").innerHTML = Object.entries(TYPES).map(([type, meta]) => `
      <button class="type-filter ${activeTypes.has(type) ? "" : "inactive"}" type="button" data-type="${type}">
        <span class="type-filter-left"><span class="type-dot" style="background:${meta.color}"></span>${meta.label}</span>
        <span class="type-count">${counts[type]}</span>
      </button>`).join("");
    $("typeFilters").querySelectorAll(".type-filter").forEach(btn => {
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        activeTypes.has(type) ? activeTypes.delete(type) : activeTypes.add(type);
        renderTypeFilters();
        applyFilters();
      });
    });
  }

  function bindUI() {
    $("newNodeBtn").addEventListener("click", newNode);
    $("emptyAddBtn").addEventListener("click", newNode);
    $("closeInspectorBtn").addEventListener("click", closeInspector);
    $("nodeForm").addEventListener("submit", saveNodeFromForm);
    $("deleteNodeBtn").addEventListener("click", deleteSelectedNode);
    $("newEdgeBtn").addEventListener("click", () => openEdgeDialog());
    $("connectFromNodeBtn").addEventListener("click", () => openEdgeDialog(selectedNodeId));
    $("closeEdgeDialogBtn").addEventListener("click", () => $("edgeDialog").close());
    $("cancelEdgeBtn").addEventListener("click", () => $("edgeDialog").close());
    $("edgeForm").addEventListener("submit", saveEdgeFromForm);
    $("layoutBtn").addEventListener("click", runLayout);
    $("fitBtn").addEventListener("click", () => cy?.fit(cy.elements(":visible"), 60));
    $("allTypesBtn").addEventListener("click", () => {
      activeTypes = new Set(Object.keys(TYPES));
      renderTypeFilters();
      applyFilters();
    });
    $("searchInput").addEventListener("input", applyFilters);
    $("projectName").addEventListener("change", (e) => {
      state.project.name = e.target.value.trim() || "Mon projet de recherche";
      saveState();
    });
    $("exportBtn").addEventListener("click", exportProject);
    $("importInput").addEventListener("change", importProject);
    $("themeBtn").addEventListener("click", toggleTheme);
    $("demoBtn").addEventListener("click", loadDemo);
    $("clearBtn").addEventListener("click", clearProject);
    $("installBtn").addEventListener("click", installApp);

    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredInstallPrompt = e;
      $("installBtn").classList.remove("hidden");
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      $("installBtn").classList.add("hidden");
      toast("Cognexus est installé.");
    });

    document.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        $("searchInput").focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newNode();
      }
      if (e.key === "Escape") {
        closeInspector();
        if ($("edgeDialog").open) $("edgeDialog").close();
      }
    });
  }

  function refreshAll(relayout = false) {
    renderTypeFilters();
    $("nodeCount").textContent = state.nodes.length;
    $("edgeCount").textContent = state.edges.length;
    $("emptyState").classList.toggle("visible", state.nodes.length === 0);

    if (cy) {
      const positions = new Map(cy.nodes().map(n => [n.id(), n.position()]));
      cy.elements().remove();
      cy.add(graphElements());
      if (!relayout) {
        cy.nodes().forEach(n => {
          const p = positions.get(n.id());
          if (p) n.position(p);
        });
      }
      cy.style(graphStyle());
      applyFilters();
      if (relayout && state.nodes.length) runLayout();
    }
    updateVisibleCount();
  }

  function applyFilters() {
    if (!cy) return;
    const q = normalize($("searchInput").value.trim());
    cy.batch(() => {
      cy.nodes().forEach(el => {
        const n = state.nodes.find(item => item.id === el.id());
        const haystack = normalize([
          n?.title, n?.summary, n?.reference, n?.notes, ...(n?.tags || [])
        ].filter(Boolean).join(" "));
        const hidden = !n || !activeTypes.has(n.type) || (q && !haystack.includes(q));
        el.toggleClass("filtered", hidden);
      });
      cy.edges().forEach(edge => {
        const hidden = edge.source().hasClass("filtered") || edge.target().hasClass("filtered");
        edge.toggleClass("filtered", hidden);
      });
    });
    updateVisibleCount();
  }

  function updateVisibleCount() {
    if (!cy) {
      $("visibleCount").textContent = "0 nœud visible";
      return;
    }
    const count = cy.nodes().filter(n => !n.hasClass("filtered")).length;
    $("visibleCount").textContent = `${count} nœud${count > 1 ? "s" : ""} visible${count > 1 ? "s" : ""}`;
  }

  function newNode() {
    editingNewNode = true;
    selectedNodeId = null;
    $("inspectorMode").textContent = "Nouveau nœud";
    $("inspectorTitle").textContent = "Créer";
    $("nodeForm").reset();
    $("nodeType").value = "concept";
    $("nodeStatus").value = "established";
    $("deleteNodeBtn").classList.add("hidden");
    $("connectionsPanel").classList.add("hidden");
    $("inspector").classList.add("open");
    setTimeout(() => $("nodeTitle").focus(), 60);
  }

  function openNode(id) {
    const n = state.nodes.find(item => item.id === id);
    if (!n) return;
    editingNewNode = false;
    selectedNodeId = id;
    $("inspectorMode").textContent = TYPES[n.type]?.label || "Nœud";
    $("inspectorTitle").textContent = n.title || "Sans titre";
    $("nodeTitle").value = n.title || "";
    $("nodeType").value = n.type || "concept";
    $("nodeStatus").value = n.status || "established";
    $("nodeSummary").value = n.summary || "";
    $("nodeTags").value = (n.tags || []).join(", ");
    $("nodeReference").value = n.reference || "";
    $("nodeUrl").value = n.url || "";
    $("nodeNotes").value = n.notes || "";
    $("deleteNodeBtn").classList.remove("hidden");
    $("connectionsPanel").classList.remove("hidden");
    renderConnections(n.id);
    $("inspector").classList.add("open");
  }

  function closeInspector() {
    $("inspector").classList.remove("open");
    if (cy) cy.$(":selected").unselect();
  }

  function saveNodeFromForm(e) {
    e.preventDefault();
    const title = $("nodeTitle").value.trim();
    if (!title) return;
    const data = {
      title,
      type: $("nodeType").value,
      status: $("nodeStatus").value,
      summary: $("nodeSummary").value.trim(),
      tags: $("nodeTags").value.split(",").map(x => x.trim()).filter(Boolean),
      reference: $("nodeReference").value.trim(),
      url: $("nodeUrl").value.trim(),
      notes: $("nodeNotes").value.trim()
    };

    if (editingNewNode) {
      const id = uid("node");
      state.nodes.push({ id, ...data });
      selectedNodeId = id;
      editingNewNode = false;
      saveState("Nœud créé");
      refreshAll(true);
      openNode(id);
      toast("Nœud créé.");
    } else {
      const index = state.nodes.findIndex(n => n.id === selectedNodeId);
      if (index < 0) return;
      state.nodes[index] = { ...state.nodes[index], ...data };
      saveState("Modifications enregistrées");
      refreshAll(false);
      openNode(selectedNodeId);
      toast("Modifications enregistrées.");
    }
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    const n = state.nodes.find(item => item.id === selectedNodeId);
    if (!n || !confirm(`Supprimer « ${n.title} » et toutes ses relations ?`)) return;
    state.nodes = state.nodes.filter(item => item.id !== selectedNodeId);
    state.edges = state.edges.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId);
    selectedNodeId = null;
    saveState("Nœud supprimé");
    closeInspector();
    refreshAll(false);
    toast("Nœud supprimé.");
  }

  function renderConnections(id) {
    const related = state.edges.filter(e => e.source === id || e.target === id);
    if (!related.length) {
      $("connectionsList").innerHTML = '<p class="save-state">Aucune relation pour ce nœud.</p>';
      return;
    }
    $("connectionsList").innerHTML = related.map(e => {
      const outgoing = e.source === id;
      const otherId = outgoing ? e.target : e.source;
      const other = state.nodes.find(n => n.id === otherId);
      return `<div class="connection-item"><strong>${escapeHtml(other?.title || "Nœud inconnu")}</strong><span>${outgoing ? "→" : "←"} ${escapeHtml(e.label || e.relation || "lié à")}</span></div>`;
    }).join("");
  }

  function openEdgeDialog(sourceId = null) {
    if (state.nodes.length < 2) {
      toast("Ajoutez au moins deux nœuds.");
      return;
    }
    const options = state.nodes.map(n => `<option value="${n.id}">${escapeHtml(n.title)}</option>`).join("");
    $("edgeSource").innerHTML = options;
    $("edgeTarget").innerHTML = options;
    $("edgeLabel").value = "";
    $("edgeRelation").value = "related to";
    if (sourceId && state.nodes.some(n => n.id === sourceId)) $("edgeSource").value = sourceId;
    const firstTarget = state.nodes.find(n => n.id !== $("edgeSource").value);
    if (firstTarget) $("edgeTarget").value = firstTarget.id;
    $("edgeDialog").showModal();
  }

  function saveEdgeFromForm(e) {
    e.preventDefault();
    const source = $("edgeSource").value;
    const target = $("edgeTarget").value;
    if (source === target) {
      toast("La source et la cible doivent être différentes.");
      return;
    }
    const relation = $("edgeRelation").value;
    const label = $("edgeLabel").value.trim() || $("edgeRelation").selectedOptions[0].textContent;
    state.edges.push({ id: uid("edge"), source, target, relation, label });
    saveState("Relation créée");
    $("edgeDialog").close();
    refreshAll(false);
    if (selectedNodeId) renderConnections(selectedNodeId);
    toast("Relation créée.");
  }

  function runLayout() {
    if (!cy || !cy.nodes(":visible").length) return;
    cy.layout({
      name: "cose",
      animate: true,
      animationDuration: 480,
      fit: true,
      padding: 70,
      nodeRepulsion: 450000,
      idealEdgeLength: 130,
      randomize: true
    }).run();
  }

  function exportProject() {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(state.project.name || "cognexus")}.cognexus.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Projet exporté.");
  }

  async function importProject(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error("Format non reconnu");
      state = {
        schemaVersion: parsed.schemaVersion || 1,
        project: parsed.project || { name: file.name.replace(/\.json$/i, "") },
        nodes: parsed.nodes,
        edges: parsed.edges
      };
      $("projectName").value = state.project.name || "Projet importé";
      saveState("Projet importé");
      closeInspector();
      refreshAll(true);
      toast("Projet importé.");
    } catch (err) {
      alert(`Import impossible : ${err.message}`);
    }
  }

  function loadDemo() {
    if (state.nodes.length && !confirm("Remplacer le projet actuel par l’exemple Cognexus ?")) return;
    state = demoState();
    $("projectName").value = state.project.name;
    saveState();
    closeInspector();
    refreshAll(true);
    toast("Exemple chargé.");
  }

  function clearProject() {
    if (!state.nodes.length) return;
    if (!confirm("Vider tous les nœuds et relations de ce projet ?")) return;
    const name = state.project.name;
    state = freshState();
    state.project.name = name;
    saveState();
    closeInspector();
    refreshAll(false);
    toast("Projet vidé.");
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    if (cy) cy.style(graphStyle());
  }

  async function installApp() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $("installBtn").classList.add("hidden");
  }

  function normalize(value) {
    return (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function slugify(value) {
    return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cognexus";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $("toast").textContent = message;
    $("toast").classList.add("show");
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 1900);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();