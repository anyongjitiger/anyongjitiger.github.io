import { geoPath } from 'd3-geo';
import { useAtom } from 'jotai';
import { feature } from 'topojson-client';
import { configurationAtom } from '../models/configuration';
import utils from '../utils/utils';

/**
 * @param resource the GeoJSON resource's URL
 * @returns {Object} a promise for GeoJSON topology features: {boundaryLo:, boundaryHi:}
 */

const log = utils.log();
function buildMesh(resource) {
  var cancel = this.cancel;
  return utils.loadJson(resource).then(function (topo) {
    if (cancel.requested) return null;
    log.time('building meshes');
    var o = topo.objects;
    var coastLo = feature(topo, utils.isMobile() ? o.coastline_tiny : o.coastline_110m);
    var coastHi = feature(topo, utils.isMobile() ? o.coastline_110m : o.coastline_50m);
    var lakesLo = feature(topo, utils.isMobile() ? o.lakes_tiny : o.lakes_110m);
    var lakesHi = feature(topo, utils.isMobile() ? o.lakes_110m : o.lakes_50m);
    log.timeEnd('building meshes');
    return {
      coastLo: coastLo,
      coastHi: coastHi,
      lakesLo: lakesLo,
      lakesHi: lakesHi
    };
  });
}

export default function HealthRegionList(props) {
  // step 1: load geoJSON and create tooltip
  // const { mapData } = useMapTools();
  const [configuration, setConfiguration] = useAtom(configurationAtom);
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
        <div id="display">
          <svg
            id="map"
            width="100vw"
            height="100vh"
            xmlns="http://www.w3.org/2000/svg"
            version="1.1"></svg>
          <canvas id="animation" width="100vw" height="100vh"></canvas>
          <canvas id="overlay" width="100vw" height="100vh"></canvas>
          <svg
            id="foreground"
            width="100vw"
            height="100vh"
            xmlns="http://www.w3.org/2000/svg"
            version="1.1"></svg>
        </div>
      </>
    );
  } else {
    return <h1>Loading...</h1>;
  }
}
