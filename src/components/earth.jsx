import { geoPath } from 'd3-geo';

export default function HealthRegionList(props) {
  // step 1: load geoJSON and create tooltip
  const { mapData } = useMapTools();

  // render map only when map data is fully loaded
  if (!mapData.loading) {
    // step 2: render the regions
    // compute a path function based on correct projections that we will use later
    const path = geoPath().projection(setMapProjection(mapData.data));
    // for each geoJSON coordinate, compute and pass in the equivalent svg path
    const healthRegions = mapData.data.features.map((data) => {
      const region_name = data.properties['NAME_ENG'];
      return <HealthRegion key={data.properties.FID} path={path(data)} tooltipData={region_name} />;
    });

    return (
      <>
        <h1>Earth</h1>
        <svg className="map-canvas">
          <g>{healthRegions}</g>
        </svg>
      </>
    );
  } else {
    return <h1>Loading...</h1>;
  }
}
