(function () {
  'use strict';

  const CONFIG = window.APP_CONFIG || {};
  const MAX_POR_EQUIPO = Number(CONFIG.MAX_POR_EQUIPO) || 5;
  const SESSION_KEY = 'torneo_inv_token';

  const state = {
    supabase: null,
    inviteToken: '',
    registroAbierto: true,
    tablero: {
      equipos: [],
      solitarios: [],
      resumen: {
        total_participantes: 0,
        total_equipos: 0,
        equipos_completos: 0,
        equipos_incompletos: 0,
        total_solitarios: 0,
        max_por_equipo: MAX_POR_EQUIPO,
      },
    },
    activeTab: 'registro',
    boardFilter: 'todos',
    boardSearch: '',
    modalContext: {
      equipoDestinoId: null,
    },
  };

  // =========================================================================
  // Utilidades
  // =========================================================================

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function setAlert(el, message, type) {
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'alert-box';
      return;
    }
    el.hidden = false;
    el.className = `alert-box ${type === 'success' ? 'alert-success' : 'alert-error'}`;
    el.textContent = message;
  }

  function showToast(message, type = 'info') {
    const container = $('toast-container');
    if (!container || !message) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 4500);
  }

  async function setButtonBusy(btn, busy, busyLabel) {
    if (!btn) return;
    if (busy) {
      btn.dataset.origText = btn.textContent;
      btn.disabled = true;
      if (busyLabel) btn.textContent = busyLabel;
    } else {
      btn.disabled = false;
      if (btn.dataset.origText) {
        btn.textContent = btn.dataset.origText;
        delete btn.dataset.origText;
      }
    }
  }

  function getCompatibleOriginTeams(targetTeam) {
    if (!targetTeam || targetTeam.esta_completo) return [];
    return state.tablero.equipos.filter(
      (eq) =>
        eq.id !== targetTeam.id &&
        eq.total_integrantes > 0 &&
        eq.total_integrantes <= targetTeam.total_integrantes &&
        eq.total_integrantes + targetTeam.total_integrantes <= MAX_POR_EQUIPO
    );
  }

  function showLockedGate(message, showHelp = true) {
    $('app-shell').hidden = true;
    $('invite-gate').hidden = false;
    $('gate-message').textContent =
      message || 'Acceso privado — Necesitas el enlace oficial de invitación.';
    $('gate-submessage').hidden = !showHelp;
  }

  function unlockAppShell() {
    $('invite-gate').hidden = true;
    $('app-shell').hidden = false;
  }

  // =========================================================================
  // Navegación por pestañas y modales
  // =========================================================================

  function switchTab(tabName) {
    state.activeTab = tabName;

    document.querySelectorAll('.nav-tab').forEach((btn) => {
      const isMatch = btn.dataset.tab === tabName;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const isMatch = panel.id === `panel-${tabName}`;
      panel.hidden = !isMatch;
      panel.classList.toggle('active', isMatch);
    });
  }

  function openModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.hidden = false;
    const firstInput = el.querySelector('select, input, textarea');
    if (firstInput) firstInput.focus();
  }

  function closeModal(modalId) {
    const el = $(modalId);
    if (!el) return;
    el.hidden = true;
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      m.hidden = true;
    });
  }

  // =========================================================================
  // Tablero público (solo nicknames y nombres de equipos)
  // =========================================================================

  function updateRegistroEstadoUI() {
    const abierto = Boolean(state.registroAbierto);
    $('reg-cerrado-banner').hidden = abierto;
    const form = $('form-registro');
    form.querySelectorAll('input, select, button').forEach((el) => {
      el.disabled = !abierto;
    });
  }

  async function cargarTableroPublico(showSpinnerToast = false) {
    if (!state.supabase || !state.inviteToken) return false;

    try {
      const { data, error } = await state.supabase.rpc('obtener_tablero_publico', {
        p_invite_token: state.inviteToken,
      });
      if (error) throw error;

      if (!data?.ok) {
        try {
          window.sessionStorage.removeItem(SESSION_KEY);
        } catch (_) {}
        showLockedGate(data?.error || 'Enlace de invitación inválido o desactivado.', true);
        return false;
      }

      try {
        window.sessionStorage.setItem(SESSION_KEY, state.inviteToken);
      } catch (_) {}

      state.registroAbierto = data.registro_abierto !== false;
      state.tablero = {
        equipos: Array.isArray(data.equipos) ? data.equipos : [],
        solitarios: Array.isArray(data.solitarios) ? data.solitarios : [],
        resumen: data.resumen || {
          total_participantes: 0,
          total_equipos: 0,
          equipos_completos: 0,
          equipos_incompletos: 0,
          total_solitarios: 0,
          max_por_equipo: MAX_POR_EQUIPO,
        },
      };

      unlockAppShell();
      updateRegistroEstadoUI();
      renderResumenStats();
      populateRegistroEquipoSelect();
      renderTableroPublico();

      if (showSpinnerToast) {
        showToast('Tablero actualizado.', 'info');
      }
      return true;
    } catch (err) {
      console.error('Error cargando tablero:', err);
      if ($('app-shell').hidden) {
        showLockedGate('No se pudo validar el enlace de invitación. Intenta de nuevo.', true);
      } else {
        showToast('No se pudo actualizar el tablero.', 'error');
      }
      return false;
    }
  }

  function renderResumenStats() {
    const r = state.tablero.resumen || {};
    $('stat-participantes').textContent = r.total_participantes ?? 0;
    $('stat-completos').textContent = r.equipos_completos ?? 0;
    $('stat-incompletos').textContent = r.equipos_incompletos ?? 0;
    $('stat-solitarios').textContent = r.total_solitarios ?? 0;
  }

  function populateRegistroEquipoSelect() {
    const select = $('reg-equipo-select');
    const hint = $('reg-equipo-vacio-hint');
    if (!select) return;

    const currentVal = select.value;
    const disponibles = state.tablero.equipos.filter((eq) => !eq.esta_completo);

    select.innerHTML = '<option value="">-- Selecciona un equipo disponible --</option>';
    disponibles.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO} — ${eq.cupos_disponibles} cupo${eq.cupos_disponibles === 1 ? '' : 's'})`;
      select.appendChild(opt);
    });

    if (currentVal && disponibles.some((eq) => eq.id === currentVal)) {
      select.value = currentVal;
    }

    const modoActual = document.querySelector('input[name="reg-modo"]:checked')?.value;
    if (hint) {
      hint.hidden = !(modoActual === 'unirse_equipo' && disponibles.length === 0);
    }
  }

  function buildSquadCardHtml(eq) {
    const isComplete = Boolean(eq.esta_completo);
    const pipsHtml = Array.from({ length: MAX_POR_EQUIPO }, (_, i) => {
      const filled = i < eq.total_integrantes;
      const cls = filled
        ? isComplete
          ? 'slot-pip slot-pip-complete'
          : 'slot-pip slot-pip-filled'
        : 'slot-pip';
      return `<span class="${cls}"></span>`;
    }).join('');

    const membersHtml = (eq.integrantes || [])
      .map(
        (m, idx) => `
        <li class="member-item">
          <span class="member-name">${escapeHtml(m.nickname)}</span>
          <span class="nick-tag">P${idx + 1}</span>
        </li>`
      )
      .join('');

    let actionsHtml = '';
    if (!isComplete) {
      const compatibles = getCompatibleOriginTeams(eq);
      const mergeBtn =
        compatibles.length > 0
          ? `<button type="button" class="btn btn-outline btn-sm" data-action="solicitar-fusion" data-equipo-id="${escapeHtml(eq.id)}">
               Unir mi equipo aquí
             </button>`
          : '';

      actionsHtml = `
        <div class="squad-actions">
          <button type="button" class="btn btn-primary btn-sm" data-action="solicitar-unirse" data-equipo-id="${escapeHtml(eq.id)}">
            Solicitar unirme
          </button>
          ${mergeBtn}
        </div>`;
    }

    return `
      <article class="squad-card ${isComplete ? 'squad-card-complete' : 'squad-card-incomplete'}">
        <div class="squad-card-head">
          <h3 class="squad-name">${escapeHtml(eq.nombre)}</h3>
          <span class="badge ${isComplete ? 'badge-green' : 'badge-amber'}">
            ${isComplete ? `COMPLETO ${eq.total_integrantes}/${MAX_POR_EQUIPO}` : `${eq.total_integrantes}/${MAX_POR_EQUIPO} JUGADORES`}
          </span>
        </div>
        <div class="slot-meter" aria-label="Cupo ${eq.total_integrantes} de ${MAX_POR_EQUIPO}">${pipsHtml}</div>
        <ul class="member-list">${membersHtml || '<li class="member-item">Sin integrantes</li>'}</ul>
        ${actionsHtml}
      </article>`;
  }

  function renderTableroPublico() {
    const container = $('tablero-contenido');
    if (!container) return;

    const query = state.boardSearch.trim().toLowerCase();
    const filter = state.boardFilter;

    const matchesTeam = (eq) => {
      if (!query) return true;
      if (eq.nombre.toLowerCase().includes(query)) return true;
      return (eq.integrantes || []).some((m) =>
        (m.nickname || '').toLowerCase().includes(query)
      );
    };

    const matchesSolo = (p) => {
      if (!query) return true;
      return (p.nickname || '').toLowerCase().includes(query);
    };

    const incompletos = state.tablero.equipos.filter((eq) => !eq.esta_completo && matchesTeam(eq));
    const completos = state.tablero.equipos.filter((eq) => eq.esta_completo && matchesTeam(eq));
    const solitarios = state.tablero.solitarios.filter(matchesSolo);

    const blocks = [];

    if (filter === 'todos' || filter === 'incompletos') {
      const cards =
        incompletos.length > 0
          ? `<div class="cards-grid">${incompletos.map(buildSquadCardHtml).join('')}</div>`
          : `<div class="empty-state">${query ? 'No hay equipos incompletos que coincidan con tu búsqueda.' : 'No hay equipos incompletos en este momento.'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Equipos Incompletos</h3>
            <span class="badge badge-amber">${incompletos.length}</span>
          </div>
          ${cards}
        </section>`);
    }

    if (filter === 'todos' || filter === 'completos') {
      const cards =
        completos.length > 0
          ? `<div class="cards-grid">${completos.map(buildSquadCardHtml).join('')}</div>`
          : `<div class="empty-state">${query ? 'No hay equipos completos que coincidan con tu búsqueda.' : 'Aún no hay equipos completos (5/5).'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Equipos Completos (5/${MAX_POR_EQUIPO})</h3>
            <span class="badge badge-green">${completos.length}</span>
          </div>
          ${cards}
        </section>`);
    }

    if (filter === 'todos' || filter === 'solitarios') {
      const solosHtml =
        solitarios.length > 0
          ? `<div class="solo-grid">
               ${solitarios
                 .map(
                   (p) => `
                   <div class="solo-card">
                     <span class="member-name">${escapeHtml(p.nickname)}</span>
                     <span class="badge badge-cyan">Solitario</span>
                   </div>`
                 )
                 .join('')}
             </div>`
          : `<div class="empty-state">${query ? 'No hay participantes solitarios que coincidan con tu búsqueda.' : 'No hay participantes solitarios disponibles.'}</div>`;

      blocks.push(`
        <section class="board-section">
          <div class="board-section-head">
            <h3 class="board-section-title">Participantes Solitarios</h3>
            <span class="badge badge-cyan">${solitarios.length}</span>
          </div>
          ${solosHtml}
        </section>`);
    }

    container.innerHTML = blocks.join('');
  }

  // =========================================================================
  // Registro de participante
  // =========================================================================

  function updateModoRegistroUI() {
    const modo = document.querySelector('input[name="reg-modo"]:checked')?.value || 'crear_equipo';
    $('group-crear-equipo').hidden = modo !== 'crear_equipo';
    $('group-unirse-equipo').hidden = modo !== 'unirse_equipo';
    $('group-solitario-hint').hidden = modo !== 'solitario';
    populateRegistroEquipoSelect();
  }

  async function handleRegistroSubmit(event) {
    event.preventDefault();
    const feedback = $('reg-feedback');
    setAlert(feedback, null);

    if (!state.registroAbierto) {
      setAlert(feedback, 'El registro se encuentra cerrado actualmente.', 'error');
      return;
    }

    const nickname = $('reg-nickname').value.trim();
    const nombre = $('reg-nombre').value.trim();
    const grado = $('reg-grado').value.trim().toUpperCase();
    const telefono = sanitizeDigits($('reg-telefono').value);
    const pin = sanitizeDigits($('reg-pin').value);
    const modo = document.querySelector('input[name="reg-modo"]:checked')?.value || 'crear_equipo';
    const nombreEquipo = $('reg-equipo-nombre').value.trim();
    const equipoId = $('reg-equipo-select').value;

    if (nickname.length < 2 || nickname.length > 25) {
      setAlert(feedback, 'Ingresa tu nickname / gamertag (entre 2 y 25 caracteres).', 'error');
      return;
    }
    if (nombre.length < 3 || nombre.length > 100) {
      setAlert(feedback, 'Ingresa tu nombre completo (entre 3 y 100 caracteres).', 'error');
      return;
    }
    if (grado.length < 2 || grado.length > 15) {
      setAlert(feedback, 'Ingresa un grado y grupo válido (ejemplo: 9N).', 'error');
      return;
    }
    if (!/^\d{10,15}$/.test(telefono)) {
      setAlert(feedback, 'Ingresa un número de WhatsApp válido de 10 a 15 dígitos.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(feedback, 'Tu PIN personal debe tener exactamente 4 dígitos numéricos.', 'error');
      return;
    }
    if (modo === 'crear_equipo' && (nombreEquipo.length < 2 || nombreEquipo.length > 40)) {
      setAlert(feedback, 'El nombre del equipo debe tener entre 2 y 40 caracteres.', 'error');
      return;
    }
    if (modo === 'unirse_equipo' && !equipoId) {
      setAlert(feedback, 'Selecciona un equipo disponible de la lista.', 'error');
      return;
    }

    const submitBtn = $('btn-reg-submit');
    await setButtonBusy(submitBtn, true, 'REGISTRANDO...');

    try {
      const { data, error } = await state.supabase.rpc('registrar_participante', {
        p_invite_token: state.inviteToken,
        p_nickname: nickname,
        p_nombre_completo: nombre,
        p_grado_grupo: grado,
        p_telefono: telefono,
        p_pin: pin,
        p_modo: modo,
        p_nombre_equipo: modo === 'crear_equipo' ? nombreEquipo : null,
        p_equipo_id: modo === 'unirse_equipo' ? equipoId : null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(feedback, data?.error || 'No se pudo completar el registro.', 'error');
        return;
      }

      $('form-registro').reset();
      $('reg-pin').type = 'password';
      $('btn-toggle-reg-pin').textContent = 'Mostrar';
      updateModoRegistroUI();

      setAlert(feedback, data.mensaje || '¡Registro completado!', 'success');
      showToast('Registro guardado correctamente.', 'success');
      await cargarTableroPublico(false);
    } catch (err) {
      console.error('Error en registro:', err);
      setAlert(feedback, err.message || 'Ocurrió un error al guardar tu registro.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  // =========================================================================
  // Modales de Solicitud Individual, Fusión y Salida de Equipo
  // =========================================================================

  function openModalSolicitudIndividual(equipoId) {
    const eq = state.tablero.equipos.find((e) => e.id === equipoId);
    if (!eq) return;

    state.modalContext.equipoDestinoId = equipoId;
    $('modal-ind-equipo-info').textContent = `Equipo destino: ${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO} integrantes — ${eq.cupos_disponibles} cupo${eq.cupos_disponibles === 1 ? '' : 's'})`;
    setAlert($('sol-ind-error'), null);
    $('sol-ind-pin').value = '';
    $('sol-ind-mensaje').value = '';
    $('sol-ind-msg-count').textContent = '0';

    const select = $('sol-ind-participante');
    const solitarios = state.tablero.solitarios;
    select.innerHTML = '<option value="">-- Selecciona tu nickname --</option>';
    solitarios.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.nickname;
      select.appendChild(opt);
    });

    const sinSolos = solitarios.length === 0;
    $('sol-ind-no-solitarios').hidden = !sinSolos;
    $('sol-ind-fields').hidden = sinSolos;

    openModal('modal-solicitud-individual');
  }

  async function handleSolicitudIndividualSubmit(event) {
    event.preventDefault();
    const errEl = $('sol-ind-error');
    setAlert(errEl, null);

    const participanteId = $('sol-ind-participante').value;
    const pin = sanitizeDigits($('sol-ind-pin').value);
    const mensaje = $('sol-ind-mensaje').value.trim();

    if (!participanteId) {
      setAlert(errEl, 'Selecciona tu nickname de la lista de solitarios.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-sol-ind-submit');
    await setButtonBusy(submitBtn, true, 'Enviando...');

    try {
      const { data, error } = await state.supabase.rpc('solicitar_unirse_equipo', {
        p_invite_token: state.inviteToken,
        p_participante_id: participanteId,
        p_pin: pin,
        p_equipo_destino_id: state.modalContext.equipoDestinoId,
        p_mensaje: mensaje || null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo enviar la solicitud.', 'error');
        return;
      }

      closeModal('modal-solicitud-individual');
      showToast(data.mensaje || 'Solicitud enviada.', 'success');
    } catch (err) {
      console.error('Error en solicitud individual:', err);
      setAlert(errEl, err.message || 'Error al enviar la solicitud.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  function populateDependentMembers(teamSelectEl, memberSelectEl) {
    const teamId = teamSelectEl.value;
    const eq = state.tablero.equipos.find((e) => e.id === teamId);
    memberSelectEl.innerHTML = '';

    if (!eq || !eq.integrantes?.length) {
      memberSelectEl.disabled = true;
      memberSelectEl.innerHTML = '<option value="">-- Primero selecciona tu equipo --</option>';
      return;
    }

    memberSelectEl.disabled = false;
    memberSelectEl.innerHTML = '<option value="">-- Selecciona tu nickname --</option>';
    eq.integrantes.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.nickname;
      memberSelectEl.appendChild(opt);
    });
  }

  function openModalSolicitudFusion(equipoDestinoId) {
    const eqDestino = state.tablero.equipos.find((e) => e.id === equipoDestinoId);
    if (!eqDestino) return;

    const compatibles = getCompatibleOriginTeams(eqDestino);
    if (compatibles.length === 0) {
      showToast('No hay equipos compatibles para fusionarse con esta escuadra.', 'info');
      return;
    }

    state.modalContext.equipoDestinoId = equipoDestinoId;
    $('modal-fus-equipo-info').textContent = `Equipo destino: ${eqDestino.nombre} (${eqDestino.total_integrantes}/${MAX_POR_EQUIPO} integrantes)`;
    setAlert($('sol-fus-error'), null);
    $('sol-fus-pin').value = '';
    $('sol-fus-mensaje').value = '';
    $('sol-fus-msg-count').textContent = '0';

    const originSelect = $('sol-fus-equipo-origen');
    originSelect.innerHTML = '<option value="">-- Selecciona tu equipo --</option>';
    compatibles.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes} integrante${eq.total_integrantes === 1 ? '' : 's'})`;
      originSelect.appendChild(opt);
    });

    populateDependentMembers(originSelect, $('sol-fus-participante'));
    openModal('modal-solicitud-fusion');
  }

  async function handleSolicitudFusionSubmit(event) {
    event.preventDefault();
    const errEl = $('sol-fus-error');
    setAlert(errEl, null);

    const originTeamId = $('sol-fus-equipo-origen').value;
    const participanteId = $('sol-fus-participante').value;
    const pin = sanitizeDigits($('sol-fus-pin').value);
    const mensaje = $('sol-fus-mensaje').value.trim();

    if (!originTeamId || !participanteId) {
      setAlert(errEl, 'Selecciona tu equipo actual y tu nickname.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-sol-fus-submit');
    await setButtonBusy(submitBtn, true, 'Enviando...');

    try {
      const { data, error } = await state.supabase.rpc('solicitar_fusion_equipos', {
        p_invite_token: state.inviteToken,
        p_participante_id: participanteId,
        p_pin: pin,
        p_equipo_destino_id: state.modalContext.equipoDestinoId,
        p_mensaje: mensaje || null,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo enviar la solicitud de fusión.', 'error');
        return;
      }

      closeModal('modal-solicitud-fusion');
      showToast(data.mensaje || 'Solicitud de fusión enviada.', 'success');
    } catch (err) {
      console.error('Error en solicitud de fusión:', err);
      setAlert(errEl, err.message || 'Error al enviar la solicitud de fusión.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  function openModalSalirEquipo() {
    setAlert($('salir-error'), null);
    $('salir-pin').value = '';

    const equiposConGente = state.tablero.equipos.filter((eq) => (eq.integrantes || []).length > 0);
    const sinEquipos = equiposConGente.length === 0;
    $('salir-no-equipos').hidden = !sinEquipos;
    $('salir-fields').hidden = sinEquipos;

    const eqSelect = $('salir-equipo-select');
    eqSelect.innerHTML = '<option value="">-- Selecciona tu equipo --</option>';
    equiposConGente.forEach((eq) => {
      const opt = document.createElement('option');
      opt.value = eq.id;
      opt.textContent = `${eq.nombre} (${eq.total_integrantes}/${MAX_POR_EQUIPO})`;
      eqSelect.appendChild(opt);
    });

    populateDependentMembers(eqSelect, $('salir-participante-select'));
    openModal('modal-salir-equipo');
  }

  async function handleSalirEquipoSubmit(event) {
    event.preventDefault();
    const errEl = $('salir-error');
    setAlert(errEl, null);

    const eqId = $('salir-equipo-select').value;
    const participanteId = $('salir-participante-select').value;
    const pin = sanitizeDigits($('salir-pin').value);

    if (!eqId || !participanteId) {
      setAlert(errEl, 'Selecciona tu equipo y tu nickname.', 'error');
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setAlert(errEl, 'Ingresa tu PIN de 4 dígitos.', 'error');
      return;
    }

    const submitBtn = $('btn-salir-submit');
    await setButtonBusy(submitBtn, true, 'Procesando...');

    try {
      const { data, error } = await state.supabase.rpc('salir_de_equipo', {
        p_invite_token: state.inviteToken,
        p_participante_id: participanteId,
        p_pin: pin,
      });

      if (error) throw error;
      if (!data?.ok) {
        setAlert(errEl, data?.error || 'No se pudo procesar tu salida.', 'error');
        return;
      }

      closeModal('modal-salir-equipo');
      showToast(data.mensaje || 'Has salido de tu equipo.', 'success');
      await cargarTableroPublico(false);
    } catch (err) {
      console.error('Error al salir de equipo:', err);
      setAlert(errEl, err.message || 'Ocurrió un error al salir del equipo.', 'error');
    } finally {
      await setButtonBusy(submitBtn, false);
    }
  }

  // =========================================================================
  // Inicialización y Listeners
  // =========================================================================

  function bindEvents() {
    document.querySelectorAll('.nav-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
      });
    });

    $('btn-refresh').addEventListener('click', async () => {
      await cargarTableroPublico(true);
    });

    $('reg-grado').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    ['reg-telefono', 'reg-pin', 'sol-ind-pin', 'sol-fus-pin', 'salir-pin'].forEach((id) => {
      const input = $(id);
      if (input) {
        input.addEventListener('input', (e) => {
          e.target.value = sanitizeDigits(e.target.value);
        });
      }
    });

    $('btn-toggle-reg-pin').addEventListener('click', () => {
      const pinInput = $('reg-pin');
      const showing = pinInput.type === 'text';
      pinInput.type = showing ? 'password' : 'text';
      $('btn-toggle-reg-pin').textContent = showing ? 'Mostrar' : 'Ocultar';
    });

    document.querySelectorAll('input[name="reg-modo"]').forEach((radio) => {
      radio.addEventListener('change', updateModoRegistroUI);
    });

    $('form-registro').addEventListener('submit', handleRegistroSubmit);

    $('tablero-busqueda').addEventListener('input', (e) => {
      state.boardSearch = e.target.value;
      renderTableroPublico();
    });

    document.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        state.boardFilter = chip.dataset.filter;
        document.querySelectorAll('[data-filter]').forEach((c) => {
          c.classList.toggle('active', c === chip);
        });
        renderTableroPublico();
      });
    });

    $('btn-abrir-salir').addEventListener('click', openModalSalirEquipo);

    $('tablero-contenido').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const equipoId = btn.dataset.equipoId;

      if (action === 'solicitar-unirse') {
        openModalSolicitudIndividual(equipoId);
      } else if (action === 'solicitar-fusion') {
        openModalSolicitudFusion(equipoId);
      }
    });

    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-close-modal]');
      if (closeBtn) {
        closeModal(closeBtn.dataset.closeModal);
        return;
      }
      if (e.target.classList.contains('modal-backdrop')) {
        e.target.hidden = true;
      }
      const goRegBtn = e.target.closest('[data-action="ir-a-registro"]');
      if (goRegBtn) {
        closeAllModals();
        switchTab('registro');
        const radioSolitario = document.querySelector('input[name="reg-modo"][value="solitario"]');
        if (radioSolitario) {
          radioSolitario.checked = true;
          updateModoRegistroUI();
        }
        $('reg-nickname').focus();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllModals();
    });

    $('sol-ind-mensaje').addEventListener('input', (e) => {
      $('sol-ind-msg-count').textContent = String(e.target.value.length);
    });
    $('sol-fus-mensaje').addEventListener('input', (e) => {
      $('sol-fus-msg-count').textContent = String(e.target.value.length);
    });

    $('sol-fus-equipo-origen').addEventListener('change', () => {
      populateDependentMembers($('sol-fus-equipo-origen'), $('sol-fus-participante'));
    });

    $('salir-equipo-select').addEventListener('change', () => {
      populateDependentMembers($('salir-equipo-select'), $('salir-participante-select'));
    });

    $('form-solicitud-individual').addEventListener('submit', handleSolicitudIndividualSubmit);
    $('form-solicitud-fusion').addEventListener('submit', handleSolicitudFusionSubmit);
    $('form-salir-equipo').addEventListener('submit', handleSalirEquipoSubmit);
  }

  function resolveInviteToken() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = (params.get('inv') || '').trim();
    if (urlToken) return urlToken;

    try {
      return (window.sessionStorage.getItem(SESSION_KEY) || '').trim();
    } catch (_) {
      return '';
    }
  }

  async function init() {
    if (!window.supabase?.createClient) {
      showLockedGate('Error al inicializar la conexión segura.', false);
      return;
    }

    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_PUBLISHABLE_KEY) {
      showLockedGate('Falta configuración de conexión.', false);
      return;
    }

    state.supabase = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_PUBLISHABLE_KEY
    );

    bindEvents();
    updateModoRegistroUI();

    state.inviteToken = resolveInviteToken();
    if (!state.inviteToken) {
      showLockedGate(
        'Acceso privado: se requiere el enlace oficial de invitación.',
        true
      );
      return;
    }

    await cargarTableroPublico(false);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
