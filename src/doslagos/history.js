const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function parseHistoryCards(cards) {
  return cards.map(text => {
    const match = text.match(/Dos Lagos Golf Course\s+(?:\w+,\s*)?(\w+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)[\s\S]*?\b(\d+)\s+Golfers?\b/i);
    if (!match) throw new Error('Unrecognized reservation history card; booking stopped');
    const [,month,day,year,hour,minute,period,golfers] = match;
    const monthIndex = months.findIndex(value => value.toLowerCase() === month.toLowerCase());
    if (monthIndex < 0) throw new Error('Unrecognized reservation date; booking stopped');
    return {date:`${year}-${String(monthIndex+1).padStart(2,'0')}-${day.padStart(2,'0')}`,
      time:`${String(Number(hour)%12+(period.toUpperCase()==='PM'?12:0)).padStart(2,'0')}:${minute}`,golfers:Number(golfers)};
  });
}
module.exports = {parseHistoryCards};
