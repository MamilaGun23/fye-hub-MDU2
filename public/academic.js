(() => {
  const db = window.fyeSupabase;
  const dateParts = () => Object.fromEntries(new Intl.DateTimeFormat('en-ZA', {
    timeZone:'Africa/Johannesburg',year:'numeric',month:'numeric',day:'numeric'
  }).formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  function cycle() { const {year,month}=dateParts(); return {year:month===1?year-1:year,open:month>=10||month===1}; }
  async function all(table,columns='*',filter=q=>q) {
    const rows=[];
    for(let start=0;start<100000;){
      const {data,error}=await filter(db.from(table).select(columns)).order('id').range(start,start+499);
      if(error) throw error; if(!data?.length)return rows; rows.push(...data);start+=data.length;
    }
    throw Error('Result is too large to load completely. Narrow the selection.');
  }
  async function mentor(id) {
    const {data,error}=await db.rpc('mentor_application_is_approved',{p_profile_id:id});
    if(error) throw error; return data===true;
  }
  function active(a) { return !a.ended_at && (a.academic_year==null||Date.parse(a.effective_end_at)>Date.now()) && Date.parse(a.assigned_at)<=Date.now(); }
  function eligible(p,q) { return p.role==='student' && p.is_active===true && !!p.academic_verified_at && p.entry_status==='first_time'
    && p.first_entry_year===dateParts().year && p.study_year===1 && q?.qualification_level==='undergraduate' && q.first_time_entry!==false; }
  window.fyeAcademic={all,mentor,active,eligible,cycle,dateParts};
})();
