// ===========================
// ORGANIZATIONAL STRUCTURE
// ===========================
async function renderOrgStructure() {
  const container = document.getElementById('orgStructureContainer');
  if (!container) return;

  // Show loading
  container.innerHTML = `
    <div style="text-align:center;color:#94a3b8;padding:40px 20px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:24px;margin-bottom:12px;"></i>
      <div>Loading organizational structure...</div>
    </div>`;

  // Load data
  await Promise.all([loadAssociates(), loadDeptHeads()]);

  // Filter out resigned associates (those with resign_date set)
  const activeAssociates = associates.filter(a => !a.resign_date);

  // Combine active associates and department heads
  const allPeople = [
    ...activeAssociates.map(a => ({
      id: a.employee_id,
      name: a.full_name,
      position: a.level || 'Associate',
      detail_area: a.detail_area || '',
      reporting_to: a.reporting_manager_id,
      type: 'associate'
    })),
    ...deptHeads.map(d => ({
      id: d.employee_id,
      name: d.full_name,
      position: d.position || 'Department Head',
      detail_area: '',
      reporting_to: d.reporting_manager_id,
      type: 'dept_head'
    }))
  ];

  console.log('[OrgStructure] Total people:', allPeople.length);
  console.log('[OrgStructure] Active Associates:', activeAssociates.length, 'Department Heads:', deptHeads.length);
  console.log('[OrgStructure] Filtered out resigned:', associates.length - activeAssociates.length);
  console.log('[OrgStructure] Sample data:', allPeople.slice(0, 5));

  // Build tree structure
  function buildTree(parentId) {
    const children = allPeople.filter(p => p.reporting_to === parentId);
    console.log(`[OrgStructure] Building tree for parent '${parentId}': found ${children.length} children`);
    
    // Sort by detail area first, then by level, then alphabetically by name.
    const detailAreaKey = (value) => (value || '').trim().toLowerCase();
    const levelPriority = (position) => {
      const pos = (position || '').toLowerCase();
      if (pos.includes('manager')) return 1;
      if (pos.includes('leader')) return 2;
      if (pos.includes('senior')) return 3;
      if (pos.includes('junior')) return 4;
      return 5;
    };

    return children
      .sort((a, b) => {
        const areaA = detailAreaKey(a.detail_area || '');
        const areaB = detailAreaKey(b.detail_area || '');
        const areaDiff = (areaA === '' ? 1 : 0) - (areaB === '' ? 1 : 0) || areaA.localeCompare(areaB, 'id');
        if (areaDiff !== 0) return areaDiff;

        const priorityA = levelPriority(a.position);
        const priorityB = levelPriority(b.position);
        if (priorityA !== priorityB) return priorityA - priorityB;

        return a.name.localeCompare(b.name, 'id');
      })
      .map(person => ({
        ...person,
        children: buildTree(person.id)
      }));
  }

  // Find root (Voon San Wong or anyone with no manager)
  const roots = allPeople.filter(p => !p.reporting_to || p.reporting_to === '');
  
  console.log('[OrgStructure] Root nodes:', roots.length, roots.map(r => ({name: r.name, id: r.id, reporting_to: r.reporting_to})));
  console.log('[OrgStructure] People reporting to "1":', allPeople.filter(p => p.reporting_to === '1').length);
  console.log('[OrgStructure] People reporting to null:', allPeople.filter(p => p.reporting_to === null).length);
  console.log('[OrgStructure] People reporting to empty string:', allPeople.filter(p => p.reporting_to === '').length);

  if (roots.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;color:#94a3b8;padding:40px 20px;">
        <i class="fa-solid fa-circle-info" style="font-size:24px;margin-bottom:12px;"></i>
        <div>No organizational structure found</div>
      </div>`;
    return;
  }

  // Build complete tree for each root
  const rootTrees = roots.map(root => ({
    ...root,
    children: buildTree(root.id)
  }));

  function groupChildrenByDetailArea(children) {
    const groups = new Map();
    children.forEach(child => {
      const key = (child.detail_area || '').trim() || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(child);
    });

    return [...groups.entries()].map(([area, items]) => ({ area, items }));
  }

  function renderChildrenList(children, allChildrenAreLeaves) {
    if (!allChildrenAreLeaves) {
      return `<ul>${children.map(child => renderNode(child)).join('')}</ul>`;
    }

    const grouped = groupChildrenByDetailArea(children);
    const listClass = 'leaf-list grouped-children';

    if (grouped.length <= 1) {
      return `<ul class="${listClass}">${children.map(child => renderLeafNode(child)).join('')}</ul>`;
    }

    return `<ul class="${listClass}">${grouped.map(group => `
      <li class="child-group">
        <div class="child-group-label">${escHtml(group.area)}</div>
        <ul class="leaf-group-items">
          ${group.items.map(child => renderLeafNode(child)).join('')}
        </ul>
      </li>
    `).join('')}</ul>`;
  }

  // Render tree as HTML with connecting lines
  function renderNode(node) {
    const hasChildren = node.children && node.children.length > 0;
    const bgColor = node.type === 'dept_head' ? '#1e6ba8' : '#1e6ba8';
    const icon = node.type === 'dept_head' ? 'fa-user-tie' : 'fa-user';
    
    // Check if all children are leaf nodes (no grandchildren)
    const allChildrenAreLeaves = hasChildren && node.children.every(child => !child.children || child.children.length === 0);
    
    // Show detail area only for associates
    const detailAreaHtml = (node.type === 'associate' && node.detail_area) 
      ? `<div style="font-size:8px;color:rgba(255,255,255,0.7);margin-top:1px;">${escHtml(node.detail_area)}</div>` 
      : '';
    
    return `
      <li>
        <div class="org-card" style="background:${bgColor};">
          <i class="fa-solid ${icon}" style="color:#fff;font-size:11px;margin-bottom:4px;"></i>
          <div style="font-weight:600;font-size:10px;color:#fff;line-height:1.3;">${escHtml(node.name)}</div>
          <div style="font-size:9px;color:rgba(255,255,255,0.8);margin-top:2px;line-height:1.2;">${escHtml(node.position)}</div>
          ${detailAreaHtml}
          <div style="font-size:8px;color:rgba(255,255,255,0.6);margin-top:2px;">${escHtml(node.id)}</div>
        </div>
        ${hasChildren ? renderChildrenList(node.children, allChildrenAreLeaves) : ''}
      </li>`;
  }

  // Render leaf nodes in vertical list format
  function renderLeafNode(node) {
    const icon = node.type === 'dept_head' ? 'fa-user-tie' : 'fa-user';
    // Show detail area only for associates
    const detailAreaText = (node.type === 'associate' && node.detail_area) 
      ? ` · ${escHtml(node.detail_area)}` 
      : '';
    return `
      <li class="leaf-item">
        <div class="org-card-leaf">
          <i class="fa-solid ${icon}" style="color:#1e6ba8;font-size:10px;"></i>
          <div style="flex:1;">
            <div style="font-weight:600;font-size:10px;color:#1e293b;line-height:1.3;">${escHtml(node.name)}</div>
            <div style="font-size:8px;color:#64748b;margin-top:1px;">${escHtml(node.position)}${detailAreaText} · ${escHtml(node.id)}</div>
          </div>
        </div>
      </li>`;
  }

  // CSS for org chart
  const orgStyles = `
    <style>
      #orgStructureContainer { padding: 0 !important; overflow-x: auto; }
      .org-tree { margin: 0; padding: 0; position: absolute; display: inline-block; align-items: center; transform: scale(1.0); transform-origin: top center; width: 100%; }
      .org-tree ul { padding-top: 12px; position: relative; }
      .org-tree li { 
        float: left; 
        text-align: center; 
        list-style-type: none; 
        position: relative; 
        padding: 12px 3px 0 1px;
      }
      .org-tree li::before, .org-tree li::after {
        content: '';
        position: absolute;
        top: 0;
        right: 50%;
        border-top: 1px solid #94a3b8;
        width: 50%;
        height: 12px;
      }
      .org-tree li::after {
        right: auto;
        left: 50%;
        border-left: 1px solid #94a3b8;
      }
      .org-tree li:only-child::after, .org-tree li:only-child::before {
        display: none;
      }
      .org-tree li:only-child {
        padding-top: 0;
      }
      .org-tree li:first-child::before, .org-tree li:last-child::after {
        border: 0 none;
      }
      .org-tree li:last-child::before {
        border-right: 1px solid #94a3b8;
        border-radius: 0 3px 0 0;
      }
      .org-tree li:first-child::after {
        border-radius: 3px 0 0 0;
      }
      .org-tree ul ul::before {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        border-left: 1px solid #94a3b8;
        width: 0;
        height: 12px;
      }
      .org-card {
        border: 1px solid #1e6ba8;
        padding: 8px 10px;
        text-align: center;
        display: inline-block;
        border-radius: 4px;
        min-width: 85px;
        max-width: 130px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        position: relative;
        background: #1e6ba8;
      }
      .org-tree > ul > li > .org-card {
        margin-top: 12px;
      }
      
      /* Leaf list - vertical layout for bottom-level nodes */
      .leaf-list {
        padding-top: 12px !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        gap: 4px !important;
      }
      .grouped-children {
        padding-top: 12px !important;
        display: flex !important;
        flex-wrap: wrap !important;
        justify-content: center !important;
        align-items: flex-start !important;
        gap: 10px !important;
      }
      .grouped-children > li {
        float: none !important;
        padding: 0 !important;
      }
      .grouped-children > li::before,
      .grouped-children > li::after {
        display: none !important;
      }
      .child-group {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        min-width: 180px;
        max-width: 240px;
      }
      .child-group-label {
        font-size: 9px;
        font-weight: 700;
        color: #1f2937;
        background: #e2e8f0;
        border: 1px solid #cbd5e1;
        border-radius: 999px;
        padding: 2px 7px;
        margin-bottom: 4px;
      }
      .child-group-items,
      .leaf-group-items {
        display: flex !important;
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 4px !important;
        padding-top: 0 !important;
        margin: 0 !important;
      }
      .child-group-items {
        width: 100%;
      }
      .leaf-group-items .leaf-item {
        width: 100%;
      }
      .leaf-list::before {
        content: '';
        position: absolute;
        top: 0;
        left: 50%;
        border-left: 1px solid #94a3b8;
        width: 0;
        height: 12px;
      }
      .leaf-item {
        float: none !important;
        padding: 0 !important;
        width: 160px;
      }
      .leaf-item::before, .leaf-item::after {
        display: none !important;
      }
      .org-card-leaf {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-left: 2px solid #1e6ba8;
        padding: 6px 10px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        text-align: left;
        width: 100%;
      }
    </style>`;

  // Render all root nodes
  const html = `
    ${orgStyles}
    <div class="org-tree">
      <ul>
        ${rootTrees.map(root => renderNode(root)).join('')}
      </ul>
    </div>`;
  
  container.innerHTML = html;
  console.log('[OrgStructure] Rendered successfully with', rootTrees.length, 'root trees');
}

// ===========================
// SIDEBAR TOGGLE
// ===========================
document.getElementById('toggleBtn').addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  } else {
    document.body.classList.toggle('sidebar-collapsed');
  }
});

// ===========================
// TOPBAR DATE
// ===========================
document.getElementById('topbarDate').textContent = formatDate(new Date());

